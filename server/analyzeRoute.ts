// =============================================================
// /api/analyze — SGF upload + job enqueue (DB-backed analysis_jobs)
// mock 실행: ANALYSIS_WORKER_MODE=inline 일 때만 Express 내 타이머,
// external 일 때는 별도 `pnpm worker:analysis` 프로세스가 claim 후 처리.
// =============================================================
//
// SECURITY NOTE: requireAnalyzeAuth 로 서버 측 인증 필수.
// 크레딧 차감·환불은 Supabase RPC 로만 수행한다.

import { nanoid } from "nanoid";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import type {
  AnalysisJobCreateResponse,
  AnalysisJobGetResponse,
  AnalysisJobResultResponse,
} from "@shared/analysisJob";
import {
  mergeDbSgfContentIntoCompletedJobData,
  normalizeAnalysisJobStatus,
  parseStoredAnalysisJobResult,
} from "@shared/analysisJob";
import { MAX_SGF_FILE_BYTES, SGF_UPLOAD_FORM_FIELD } from "@shared/const";
import {
  ANALYSIS_REQUEST_ID_HEADER,
  normalizeAnalysisRequestId,
} from "@shared/analysisRequestId";
import {
  analyzeGetUserLimit,
  analyzePostIpLimit,
  analyzePostUserLimit,
  analyzeTimelineProgressGetUserLimit,
} from "./middleware/apiRateLimit";
import {
  logAnalysisEngineSnapshot,
  publicAnalysisJobErrorMessage,
  resolveCompletedJobMetaMock,
} from "./analysisEngineDeterminism";
import {
  analyzeEnqueueAdmissionCode,
  shouldEnqueueAnalysisJobAsMock,
} from "./middleware/analyzeEnqueueGuard";
import { getAnalysisEngineName } from "./worker/analysisEngines/config";
import {
  requireAnalyzeAuth,
  requireAnalyzeAuthBeforeAdmission,
} from "./middleware/requireAnalyzeAuth";
import { getAnalysisWorkerMode } from "./analysisWorkerMode";
import { provisionClerkUserForFirstUse } from "./_core/clerkAuth";
import { isMockAnalysisAllowed } from "./_core/env";
import { analysisJobStore } from "./inMemoryAnalysisJobStore";
import type { AnalysisJobLanguage } from "./analysisJobStore.types";
import { validateSgfText } from "./sgfValidation";
import { sha256HexUtf8, utf8ByteLength } from "./sgfPayload";
import { SupabaseAdminUnavailableError } from "./_core/supabaseAdmin";
import type {
  AnalysisJobResultDbRow,
  AnalysisJobStatusDbRow,
} from "./creditService";
import {
  ensureWalletWithSignupBonus,
  enqueuePaidAnalysisJob,
  getAnalysisJobResultForOwner,
  getAnalysisJobStatusByRequestForOwner,
  getAnalysisJobStatusForOwner,
  purgeFinalAnalysisJobData,
  refundCreditIfJobFailed,
  walletSubjectFromAuthUser,
} from "./creditService";
import { readWinrateTimelineLocalProgressEnabledFrom } from "./worker/analysisEngines/winrateTimelineConfig";
import { readWinrateTimelineProgressV1 } from "./winrateTimelineProgressV1";

function analysisJobStatusRowToGetResponse(
  row: AnalysisJobStatusDbRow
): AnalysisJobGetResponse {
  const status = normalizeAnalysisJobStatus(row.status);

  const progress =
    row.progress ??
    (status === "queued"
      ? 0
      : status === "completed"
        ? 100
        : status === "failed"
          ? null
          : 40);

  const base = {
    success: true as const,
    jobId: row.id,
    status,
    progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(status === "completed"
      ? { resultVersion: "analysis-job-result-v1" as const }
      : {}),
  };

  if (status === "failed") {
    return {
      ...base,
      error: { message: publicAnalysisJobErrorMessage(row.last_error_code) },
    };
  }

  return base;
}

function analysisJobResultRowToResponse(
  row: AnalysisJobResultDbRow
): AnalysisJobResultResponse | null {
  const status = normalizeAnalysisJobStatus(row.status);
  const parsedResult = parseStoredAnalysisJobResult(row.result);
  if (status !== "completed" || parsedResult == null) {
    return null;
  }
  return {
    success: true,
    jobId: row.id,
    status: "completed",
    progress: 100,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resultVersion: "analysis-job-result-v1",
    data: mergeDbSgfContentIntoCompletedJobData(parsedResult, row.sgf_content),
    meta: resolveCompletedJobMetaMock(row, parsedResult),
  };
}

const SUPPORTED_LANGUAGES = new Set<AnalysisJobLanguage>([
  "ko",
  "en",
  "zh",
  "ja",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // Busboy emits `limit` when bytes reach fileSize, so MAX + 1 preserves the
    // public contract that exactly MAX_SGF_FILE_BYTES is accepted.
    fileSize: MAX_SGF_FILE_BYTES + 1,
    files: 1,
    fields: 1,
    // Busboy raises partsLimit when the counter reaches the configured value,
    // so two accepted parts (one file + language) require a sentinel of three.
    parts: 3,
    fieldSize: 32,
    fieldNameSize: 32,
    fieldNestingDepth: 0,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".sgf")) {
      cb(
        new Error(
          "Only .sgf files are allowed. Please upload a file whose name ends with .sgf."
        )
      );
      return;
    }
    cb(null, true);
  },
});

const analyzeRouter = Router();

function emptyTimelineProgressResponse(jobId: string, enabled: boolean) {
  return {
    success: true as const,
    jobId,
    enabled,
    events: [],
    points: [],
    completedCount: 0,
    partialCount: 0,
    totalPoints: null,
  };
}

function parseLanguage(req: Request): AnalysisJobLanguage {
  const raw = req.body?.language;
  if (
    typeof raw === "string" &&
    SUPPORTED_LANGUAGES.has(raw as AnalysisJobLanguage)
  ) {
    return raw as AnalysisJobLanguage;
  }
  return "ko";
}

function sendUploadError(
  res: Response,
  status: number,
  message: string,
  code?: string
) {
  res.status(status).json({
    success: false,
    ...(code ? { code } : {}),
    message,
  });
}

function privateNoStore(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.set("Cache-Control", "private, no-store");
  next();
}

function analysisRequestIdFrom(req: Request): string | null {
  return normalizeAnalysisRequestId(req.get(ANALYSIS_REQUEST_ID_HEADER));
}

function requireAnalysisRequestId(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const raw = req.get(ANALYSIS_REQUEST_ID_HEADER);
  const normalized = normalizeAnalysisRequestId(raw);
  const required =
    process.env.ANALYSIS_IDEMPOTENCY_KEY_REQUIRED?.trim().toLowerCase() ===
    "true";
  if ((raw != null && normalized == null) || (raw == null && required)) {
    sendUploadError(
      res,
      400,
      `${ANALYSIS_REQUEST_ID_HEADER} must be a 16-128 character opaque request ID.`,
      "ANALYSIS_REQUEST_ID_INVALID"
    );
    return;
  }
  next();
}

function decodeSgfUploadUtf8(buffer: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function handleMulterUpload(req: Request, res: Response, next: NextFunction) {
  upload.single(SGF_UPLOAD_FORM_FIELD)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        sendUploadError(
          res,
          413,
          `The SGF file is too large. Maximum size is ${MAX_SGF_FILE_BYTES / (1024 * 1024)} MB.`
        );
        return;
      }
      sendUploadError(res, 400, `Upload error: ${err.message}`);
      return;
    }
    if (err instanceof Error) {
      sendUploadError(res, 400, err.message);
      return;
    }
    sendUploadError(res, 400, "Invalid file upload.");
  });
}

analyzeRouter.get(
  "/api/analyze/:jobId/timeline-progress",
  privateNoStore,
  requireAnalyzeAuth,
  analyzeTimelineProgressGetUserLimit,
  (req: Request, res: Response) => {
    void (async () => {
      const user = req.katatalkUser;
      if (!user) {
        sendUploadError(
          res,
          401,
          "로그인이 필요합니다. 로그인 후 다시 시도해 주세요."
        );
        return;
      }
      const jobId = req.params.jobId;
      if (!jobId || typeof jobId !== "string") {
        sendUploadError(res, 400, "Missing job ID.");
        return;
      }
      const viewer = walletSubjectFromAuthUser(user);
      let row: AnalysisJobStatusDbRow | null = null;
      try {
        row = await getAnalysisJobStatusForOwner(jobId, viewer);
      } catch (e) {
        if (e instanceof SupabaseAdminUnavailableError) {
          sendUploadError(
            res,
            503,
            "크레딧·작업 조회를 위해 Supabase 서버 설정이 필요합니다."
          );
          return;
        }
        console.error("[analyze] timeline-progress owner status", e);
        sendUploadError(res, 500, "작업을 불러오지 못했습니다.");
        return;
      }
      if (row == null) {
        res.status(404).json({ success: false, message: "Job not found." });
        return;
      }
      if (!readWinrateTimelineLocalProgressEnabledFrom(process.env)) {
        res.json(emptyTimelineProgressResponse(jobId, false));
        return;
      }
      const progress = await readWinrateTimelineProgressV1(jobId);
      if (progress == null) {
        res.json(emptyTimelineProgressResponse(jobId, true));
        return;
      }
      res.json(progress);
    })();
  }
);

analyzeRouter.get(
  "/api/analyze/requests/:requestId",
  privateNoStore,
  requireAnalyzeAuth,
  analyzeGetUserLimit,
  (req: Request, res: Response) => {
    void (async () => {
      const user = req.katatalkUser;
      if (!user) {
        sendUploadError(res, 401, "Authentication is required.");
        return;
      }
      const requestId = normalizeAnalysisRequestId(req.params.requestId);
      if (requestId == null) {
        sendUploadError(
          res,
          400,
          "Invalid analysis request ID.",
          "ANALYSIS_REQUEST_ID_INVALID"
        );
        return;
      }

      try {
        const row = await getAnalysisJobStatusByRequestForOwner(
          requestId,
          walletSubjectFromAuthUser(user)
        );
        if (row == null) {
          res.status(404).json({ success: false, message: "Job not found." });
          return;
        }
        res.json(analysisJobStatusRowToGetResponse(row));
      } catch (error) {
        if (error instanceof SupabaseAdminUnavailableError) {
          sendUploadError(
            res,
            503,
            "Analysis request recovery requires Supabase server configuration."
          );
          return;
        }
        console.error("[analyze] getAnalysisJobStatusByRequestForOwner", error);
        sendUploadError(res, 500, "Could not recover the analysis request.");
      }
    })();
  }
);

analyzeRouter.get(
  "/api/analyze/:jobId",
  privateNoStore,
  requireAnalyzeAuth,
  analyzeGetUserLimit,
  (req: Request, res: Response) => {
    void (async () => {
      const user = req.katatalkUser;
      if (!user) {
        sendUploadError(
          res,
          401,
          "로그인이 필요합니다. 로그인 후 다시 시도해 주세요."
        );
        return;
      }

      const jobId = req.params.jobId;
      if (!jobId || typeof jobId !== "string") {
        sendUploadError(res, 400, "Missing job ID.");
        return;
      }

      const viewer = walletSubjectFromAuthUser(user);

      let row: AnalysisJobStatusDbRow | null = null;
      try {
        row = await getAnalysisJobStatusForOwner(jobId, viewer);
      } catch (e) {
        if (e instanceof SupabaseAdminUnavailableError) {
          sendUploadError(
            res,
            503,
            "크레딧·작업 조회를 위해 Supabase 서버 설정(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)이 필요합니다."
          );
          return;
        }
        console.error("[analyze] getAnalysisJobStatusForOwner", e);
        sendUploadError(res, 500, "작업을 불러오지 못했습니다.");
        return;
      }

      if (row == null) {
        res.status(404).json({
          success: false,
          message: "Job not found. It may have expired or the ID is invalid.",
        });
        return;
      }

      const payload = analysisJobStatusRowToGetResponse(row);
      res.json(payload);
    })();
  }
);

analyzeRouter.get(
  "/api/analyze/:jobId/result",
  privateNoStore,
  requireAnalyzeAuth,
  analyzeGetUserLimit,
  (req: Request, res: Response) => {
    void (async () => {
      const user = req.katatalkUser;
      const jobId = req.params.jobId;
      if (!user) {
        sendUploadError(res, 401, "Authentication is required.");
        return;
      }
      if (!jobId || typeof jobId !== "string") {
        sendUploadError(res, 400, "Missing job ID.");
        return;
      }

      try {
        const row = await getAnalysisJobResultForOwner(
          jobId,
          walletSubjectFromAuthUser(user)
        );
        if (row == null) {
          res.status(404).json({ success: false, message: "Job not found." });
          return;
        }
        if (row.data_purged_at) {
          res.status(410).json({
            success: false,
            code: "ANALYSIS_RESULT_PURGED",
            message: "Analysis result data has been deleted.",
          });
          return;
        }
        if (normalizeAnalysisJobStatus(row.status) !== "completed") {
          res.status(409).json({
            success: false,
            code: "ANALYSIS_RESULT_NOT_READY",
            message: "Analysis result is not ready.",
          });
          return;
        }

        const payload = analysisJobResultRowToResponse(row);
        if (payload == null) {
          console.error("[analyze] completed result invariant", { jobId });
          sendUploadError(res, 500, "Analysis result is unavailable.");
          return;
        }
        const serializedPayload = JSON.stringify(payload);
        const etag = `"sha256-${sha256HexUtf8(serializedPayload)}"`;
        res.set("ETag", etag);
        if (payload.meta?.mock) {
          res.set("X-KataTalk-Mock", "true");
        }
        if (req.get("If-None-Match") === etag) {
          res.status(304).end();
          return;
        }
        res.type("application/json").send(serializedPayload);
      } catch (error) {
        if (error instanceof SupabaseAdminUnavailableError) {
          sendUploadError(
            res,
            503,
            "Analysis result requires Supabase server configuration."
          );
          return;
        }
        console.error("[analyze] getAnalysisJobResultForOwner", error);
        sendUploadError(res, 500, "Could not load analysis result.");
      }
    })();
  }
);

analyzeRouter.delete(
  "/api/analyze/:jobId/data",
  privateNoStore,
  requireAnalyzeAuth,
  analyzeGetUserLimit,
  (req: Request, res: Response) => {
    void (async () => {
      const user = req.katatalkUser;
      const jobId = req.params.jobId;
      if (!user) {
        sendUploadError(res, 401, "Authentication is required.");
        return;
      }
      if (!jobId || typeof jobId !== "string") {
        sendUploadError(res, 400, "Missing job ID.");
        return;
      }
      const profileId = walletSubjectFromAuthUser(user);
      try {
        const row = await getAnalysisJobStatusForOwner(jobId, profileId);
        if (row == null) {
          res.status(404).json({ success: false, message: "Job not found." });
          return;
        }
        if (row.data_purged_at) {
          res.status(204).end();
          return;
        }
        if (row.status !== "completed" && row.status !== "failed") {
          res.status(409).json({
            success: false,
            message:
              "Analysis data can only be deleted after processing finishes.",
          });
          return;
        }
        const result = await purgeFinalAnalysisJobData({ jobId, profileId });
        if (!result.ok) {
          res.status(409).json({
            success: false,
            message: "Analysis data could not be deleted in its current state.",
          });
          return;
        }
        res.status(204).end();
      } catch (error) {
        if (error instanceof SupabaseAdminUnavailableError) {
          sendUploadError(
            res,
            503,
            "Analysis data deletion requires Supabase server configuration."
          );
          return;
        }
        console.error("[analyze] purge analysis data", error);
        sendUploadError(res, 500, "Could not delete analysis data.");
      }
    })();
  }
);

analyzeRouter.post(
  "/api/analyze",
  privateNoStore,
  analyzePostIpLimit,
  requireAnalyzeAuthBeforeAdmission,
  analyzePostUserLimit,
  requireAnalysisRequestId,
  handleMulterUpload,
  (req: Request, res: Response) => {
    void (async () => {
      let user = req.katatalkUser;
      if (!user) {
        sendUploadError(
          res,
          401,
          "로그인이 필요합니다. 로그인 후 다시 시도해 주세요."
        );
        return;
      }

      const file = req.file;
      if (!file) {
        sendUploadError(
          res,
          400,
          `Missing SGF file. Use multipart/form-data with field "${SGF_UPLOAD_FORM_FIELD}" containing the .sgf file.`
        );
        return;
      }

      const sgfContent = decodeSgfUploadUtf8(file.buffer);
      if (sgfContent == null) {
        sendUploadError(
          res,
          400,
          "Invalid SGF: the uploaded file must be valid UTF-8.",
          "SGF_INVALID_ENCODING"
        );
        return;
      }

      const validation = validateSgfText(sgfContent);
      if (!validation.ok) {
        sendUploadError(res, 400, validation.message, validation.code);
        return;
      }

      try {
        user = await provisionClerkUserForFirstUse(user);
        await ensureWalletWithSignupBonus(user);
      } catch (e) {
        if (e instanceof SupabaseAdminUnavailableError) {
          res.status(503).json({
            success: false,
            code: "SUPABASE_CREDIT_UNAVAILABLE",
            message: e.message,
          });
          return;
        }
        console.error("[analyze] ensureWallet", e);
        res.status(503).json({
          success: false,
          code: "CREDITS_UNAVAILABLE",
          message:
            "크레딧 프로필을 준비하지 못했습니다. 서버 설정을 확인해 주세요.",
        });
        return;
      }

      const language = parseLanguage(req);
      const fileName = file.originalname.trim() || "uploaded.sgf";
      const requestId = analysisRequestIdFrom(req);
      const idempotencyProtected = requestId != null;
      const effectiveRequestId = requestId ?? `legacy.${nanoid(32)}`;

      const jobId = nanoid();
      {
        const sgfSha256 = sha256HexUtf8(sgfContent);
        const requestFingerprint = sha256HexUtf8(
          `analysis-request-v1\n${sgfSha256}\n${language}`
        );
        const sgfSizeBytes = utf8ByteLength(sgfContent);
        const enqueueIsMock = shouldEnqueueAnalysisJobAsMock();
        let enqueue: Awaited<ReturnType<typeof enqueuePaidAnalysisJob>>;
        try {
          enqueue = await enqueuePaidAnalysisJob({
            user,
            jobId,
            requestId: effectiveRequestId,
            requestFingerprint,
            fileName,
            language,
            sgfContent,
            sgfSha256,
            sgfSizeBytes,
            isMock: enqueueIsMock,
            admissionCode: analyzeEnqueueAdmissionCode(),
          });
        } catch (e) {
          console.error("[analyze] enqueuePaidAnalysisJob", e);
          res.status(503).json({
            success: false,
            code: "CREDITS_UNAVAILABLE",
            message: "Unable to create analysis job.",
          });
          return;
        }
        if (!enqueue.ok) {
          const status =
            enqueue.code === "INSUFFICIENT_CREDITS"
              ? 402
              : enqueue.code === "INVALID_ARGUMENT"
                ? 400
                : enqueue.code === "LEDGER_INVARIANT" ||
                    enqueue.code === "RPC_PROTOCOL_ERROR"
                  ? 503
                  : enqueue.code === "ANALYSIS_IDEMPOTENCY_UNAVAILABLE" ||
                      enqueue.code === "KATAGO_INLINE_FORBIDDEN" ||
                      enqueue.code === "MOCK_ANALYSIS_DISABLED"
                    ? 503
                    : 409;
          res.status(status).json({
            success: false,
            code: enqueue.code,
            message: "Unable to create analysis job.",
          });
          return;
        }
        const effectiveJobId = enqueue.jobId;
        if (!enqueue.replayed) {
          logAnalysisEngineSnapshot({
            phase: "enqueue",
            jobId: effectiveJobId,
            rowIsMock: enqueueIsMock,
            selectedPipeline: enqueueIsMock ? "mock" : "katago",
          });
        }
        if (
          !enqueue.replayed &&
          getAnalysisWorkerMode() === "inline" &&
          isMockAnalysisAllowed()
        ) {
          analysisJobStore.createAndEnqueueMock({
            jobId: effectiveJobId,
            payload: { fileName, language },
            onJobFailed: () => {
              void refundCreditIfJobFailed(user, effectiveJobId, 1);
            },
          });
        }
        const body: AnalysisJobCreateResponse = {
          success: true,
          jobId: effectiveJobId,
          status: normalizeAnalysisJobStatus(enqueue.jobStatus),
          replayed: enqueue.replayed,
          idempotencyProtected,
          creditBalance: enqueue.balanceAfter,
          remainingCredits: enqueue.balanceAfter,
        };
        res.status(enqueue.replayed ? 200 : 202).json(body);
        return;
      }
    })();
  }
);

export { analyzeRouter };
