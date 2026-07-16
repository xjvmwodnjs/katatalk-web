// =============================================================
// /api/analyze — SGF upload + job enqueue (DB-backed analysis_jobs)
// mock 실행: ANALYSIS_WORKER_MODE=inline 일 때만 Express 내 타이머,
// external 일 때는 별도 `pnpm worker:analysis` 프로세스가 claim 후 처리.
// =============================================================
//
// SECURITY NOTE: requireAnalyzeAuth 로 서버 측 인증 필수.
// 크레딧 차감·환불은 Supabase RPC 로만 수행한다.

import { nanoid } from "nanoid";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { AnalysisJobCreateResponse, AnalysisJobGetResponse } from "@shared/analysisJob";
import {
  mergeDbSgfContentIntoCompletedJobData,
  normalizeAnalysisJobStatus,
  parseStoredAnalysisJobResult,
} from "@shared/analysisJob";
import { MAX_SGF_FILE_BYTES, SGF_UPLOAD_FORM_FIELD } from "@shared/const";
import {
  analyzeGetUserLimit,
  analyzePostIpLimit,
  analyzePostUserLimit,
  analyzeTimelineProgressGetUserLimit,
} from "./middleware/apiRateLimit";
import { logAnalysisEngineSnapshot, resolveCompletedJobMetaMock } from "./analysisEngineDeterminism";
import {
  requireAnalyzeEnqueueAllowed,
  shouldEnqueueAnalysisJobAsMock,
} from "./middleware/analyzeEnqueueGuard";
import { getAnalysisEngineName } from "./worker/analysisEngines/config";
import { requireAnalyzeAuth } from "./middleware/requireAnalyzeAuth";
import { getAnalysisWorkerMode } from "./analysisWorkerMode";
import { isMockAnalysisAllowed } from "./_core/env";
import { analysisJobStore } from "./inMemoryAnalysisJobStore";
import type { AnalysisJobLanguage } from "./analysisJobStore.types";
import { validateSgfText } from "./sgfValidation";
import { sha256HexUtf8, utf8ByteLength } from "./sgfPayload";
import { SupabaseAdminUnavailableError } from "./_core/supabaseAdmin";
import type { AnalysisJobDbRow } from "./creditService";
import {
  ensureWalletWithSignupBonus,
  enqueuePaidAnalysisJob,
  getAnalysisJobRow,
  insertAnalysisJobQueued,
  purgeFinalAnalysisJobData,
  refundCreditIfJobFailed,
  spendCreditForAnalysisJob,
  walletSubjectFromAuthUser,
} from "./creditService";
import { readWinrateTimelineLocalProgressEnabledFrom } from "./worker/analysisEngines/winrateTimelineConfig";
import { readWinrateTimelineProgressV1 } from "./winrateTimelineProgressV1";

function analysisJobDbRowToGetResponse(row: AnalysisJobDbRow): AnalysisJobGetResponse {
  const status = normalizeAnalysisJobStatus(row.status);
  const parsedResult = parseStoredAnalysisJobResult(row.result);

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
  };

  if (status === "failed") {
    return {
      ...base,
      error: { message: row.error_message ?? "Analysis failed." },
    };
  }

  if (status === "completed" && parsedResult != null) {
    const dataForClient = mergeDbSgfContentIntoCompletedJobData(parsedResult, row.sgf_content);
    return {
      ...base,
      data: dataForClient,
      meta: resolveCompletedJobMetaMock(row, parsedResult),
    };
  }

  return base;
}

const SUPPORTED_LANGUAGES = new Set<AnalysisJobLanguage>(["ko", "en", "zh", "ja"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SGF_FILE_BYTES, files: 1 },
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
  if (typeof raw === "string" && SUPPORTED_LANGUAGES.has(raw as AnalysisJobLanguage)) {
    return raw as AnalysisJobLanguage;
  }
  return "ko";
}

function sendUploadError(res: Response, status: number, message: string) {
  res.status(status).json({ success: false, message });
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
  requireAnalyzeAuth,
  analyzeTimelineProgressGetUserLimit,
  (req: Request, res: Response) => {
    void (async () => {
      const user = req.katatalkUser;
      if (!user) {
        sendUploadError(res, 401, "로그인이 필요합니다. 로그인 후 다시 시도해 주세요.");
        return;
      }
      const jobId = req.params.jobId;
      if (!jobId || typeof jobId !== "string") {
        sendUploadError(res, 400, "Missing job ID.");
        return;
      }
      const viewer = walletSubjectFromAuthUser(user);
      let row: AnalysisJobDbRow | null = null;
      try {
        row = await getAnalysisJobRow(jobId);
      } catch (e) {
        if (e instanceof SupabaseAdminUnavailableError) {
          sendUploadError(res, 503, "크레딧·작업 조회를 위해 Supabase 서버 설정이 필요합니다.");
          return;
        }
        console.error("[analyze] timeline-progress getAnalysisJobRow", e);
        sendUploadError(res, 500, "작업을 불러오지 못했습니다.");
        return;
      }
      if (row == null) {
        res.status(404).json({ success: false, message: "Job not found." });
        return;
      }
      if (row.user_id !== viewer) {
        res.status(403).json({ success: false, message: "이 분석 결과에 접근할 권한이 없습니다." });
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
  "/api/analyze/:jobId",
  requireAnalyzeAuth,
  analyzeGetUserLimit,
  (req: Request, res: Response) => {
  void (async () => {
    const user = req.katatalkUser;
    if (!user) {
      sendUploadError(res, 401, "로그인이 필요합니다. 로그인 후 다시 시도해 주세요.");
      return;
    }

    const jobId = req.params.jobId;
    if (!jobId || typeof jobId !== "string") {
      sendUploadError(res, 400, "Missing job ID.");
      return;
    }

    const viewer = walletSubjectFromAuthUser(user);

    let row: AnalysisJobDbRow | null = null;
    try {
      row = await getAnalysisJobRow(jobId);
    } catch (e) {
      if (e instanceof SupabaseAdminUnavailableError) {
        sendUploadError(
          res,
          503,
          "크레딧·작업 조회를 위해 Supabase 서버 설정(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)이 필요합니다."
        );
        return;
      }
      console.error("[analyze] getAnalysisJobRow", e);
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

    if (row.user_id !== viewer) {
      res.status(403).json({
        success: false,
        message: "이 분석 결과에 접근할 권한이 없습니다.",
      });
      return;
    }

    const payload = analysisJobDbRowToGetResponse(row);
    if (payload.status === "completed" && payload.meta?.mock) {
      res.set("X-KataTalk-Mock", "true");
    }
    res.json(payload);
  })();
});

analyzeRouter.delete(
  "/api/analyze/:jobId/data",
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
        const row = await getAnalysisJobRow(jobId);
        if (row == null) {
          res.status(404).json({ success: false, message: "Job not found." });
          return;
        }
        if (row.user_id !== profileId) {
          res.status(403).json({ success: false, message: "Not allowed to delete this analysis data." });
          return;
        }
        if (row.data_purged_at) {
          res.status(204).end();
          return;
        }
        if (row.status !== "completed" && row.status !== "failed") {
          res.status(409).json({ success: false, message: "Analysis data can only be deleted after processing finishes." });
          return;
        }
        const result = await purgeFinalAnalysisJobData({ jobId, profileId });
        if (!result.ok) {
          res.status(409).json({ success: false, message: "Analysis data could not be deleted in its current state." });
          return;
        }
        res.status(204).end();
      } catch (error) {
        if (error instanceof SupabaseAdminUnavailableError) {
          sendUploadError(res, 503, "Analysis data deletion requires Supabase server configuration.");
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
  analyzePostIpLimit,
  requireAnalyzeAuth,
  analyzePostUserLimit,
  requireAnalyzeEnqueueAllowed,
  handleMulterUpload,
  (req: Request, res: Response) => {
    void (async () => {
      const user = req.katatalkUser;
      if (!user) {
        sendUploadError(res, 401, "로그인이 필요합니다. 로그인 후 다시 시도해 주세요.");
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

      const sgfContent = file.buffer.toString("utf8");

      const validation = validateSgfText(sgfContent);
      if (!validation.ok) {
        sendUploadError(res, 400, validation.message);
        return;
      }

      try {
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
          message: "크레딧 프로필을 준비하지 못했습니다. 서버 설정을 확인해 주세요.",
        });
        return;
      }

      const language = parseLanguage(req);
      const fileName = file.originalname.trim() || "uploaded.sgf";

      const jobId = nanoid();
      if (process.env.KATATALK_ATOMIC_ENQUEUE !== "false") {
        const sgfSha256 = sha256HexUtf8(sgfContent);
        const sgfSizeBytes = utf8ByteLength(sgfContent);
        const enqueueIsMock = shouldEnqueueAnalysisJobAsMock();
        let enqueue: Awaited<ReturnType<typeof enqueuePaidAnalysisJob>>;
        try {
          enqueue = await enqueuePaidAnalysisJob({
            user,
            jobId,
            fileName,
            language,
            sgfContent,
            sgfSha256,
            sgfSizeBytes,
            isMock: enqueueIsMock,
          });
        } catch (e) {
          console.error("[analyze] enqueuePaidAnalysisJob", e);
          res.status(503).json({ success: false, code: "CREDITS_UNAVAILABLE", message: "Unable to create analysis job." });
          return;
        }
        if (!enqueue.ok) {
          res.status(enqueue.code === "INSUFFICIENT_CREDITS" ? 402 : 409).json({
            success: false,
            code: enqueue.code,
            message: "Unable to create analysis job.",
          });
          return;
        }
        logAnalysisEngineSnapshot({
          phase: "enqueue",
          jobId,
          rowIsMock: enqueueIsMock,
          selectedPipeline: enqueueIsMock ? "mock" : "katago",
        });
        if (getAnalysisWorkerMode() === "inline" && isMockAnalysisAllowed()) {
          analysisJobStore.createAndEnqueueMock({
            jobId,
            payload: { fileName, language },
            onJobFailed: () => { void refundCreditIfJobFailed(user, jobId, 1); },
          });
        }
        const body: AnalysisJobCreateResponse = {
          success: true,
          jobId,
          status: "queued",
          creditBalance: enqueue.balanceAfter,
          remainingCredits: enqueue.balanceAfter,
        };
        res.status(202).json(body);
        return;
      }
      const profileId = walletSubjectFromAuthUser(user);

      let spend: Awaited<ReturnType<typeof spendCreditForAnalysisJob>>;
      try {
        spend = await spendCreditForAnalysisJob(user, jobId, 1);
      } catch (e) {
        if (e instanceof SupabaseAdminUnavailableError) {
          res.status(503).json({
            success: false,
            code: "SUPABASE_CREDIT_UNAVAILABLE",
            message: e.message,
          });
          return;
        }
        console.error("[analyze] spendCredit", e);
        res.status(503).json({
          success: false,
          code: "CREDITS_UNAVAILABLE",
          message: "크레딧 차감에 실패했습니다. 서버 설정을 확인해 주세요.",
        });
        return;
      }

      if (!spend.ok) {
        res.status(402).json({
          success: false,
          code: spend.code === "PROFILE_NOT_FOUND" ? "PROFILE_NOT_FOUND" : "INSUFFICIENT_CREDITS",
          message: "크레딧이 부족합니다. 크레딧을 충전한 뒤 다시 시도해 주세요.",
        });
        return;
      }

      const sgfSha256 = sha256HexUtf8(sgfContent);
      const sgfSizeBytes = utf8ByteLength(sgfContent);
      const enqueueIsMock = shouldEnqueueAnalysisJobAsMock();
      console.log("[analyze] job enqueued", {
        jobId,
        fileName,
        sgfSizeBytes,
        sgfSha256Prefix: sgfSha256.slice(0, 12),
        isMock: enqueueIsMock,
        analysisEngine: getAnalysisEngineName(),
        workerMode: getAnalysisWorkerMode(),
      });
      logAnalysisEngineSnapshot({
        phase: "enqueue",
        jobId,
        rowIsMock: enqueueIsMock,
        selectedPipeline: enqueueIsMock ? "mock" : "katago",
      });

      try {
        await insertAnalysisJobQueued({
          jobId,
          profileId,
          fileName,
          language,
          creditLogId: spend.ledgerId,
          creditCost: 1,
          sgfContent: sgfContent,
          sgfSha256,
          sgfSizeBytes,
          isMock: enqueueIsMock,
        });
      } catch (e) {
        console.error("[analyze] insertAnalysisJobQueued", e);
        await refundCreditIfJobFailed(user, jobId, 1);
        res.status(500).json({
          success: false,
          message: "분석 작업을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        });
        return;
      }

      const workerMode = getAnalysisWorkerMode();
      if (workerMode === "inline" && isMockAnalysisAllowed()) {
        try {
          analysisJobStore.createAndEnqueueMock({
            jobId,
            payload: { fileName, language },
            onJobFailed: () => {
              void refundCreditIfJobFailed(user, jobId, 1);
            },
          });
        } catch (e) {
          console.error("[analyze] enqueue", e);
          await refundCreditIfJobFailed(user, jobId, 1);
          res.status(500).json({
            success: false,
            message: "분석 작업을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.",
          });
          return;
        }
      }

      const body: AnalysisJobCreateResponse = {
        success: true,
        jobId,
        status: "queued",
        creditBalance: spend.balanceAfter,
        remainingCredits: spend.balanceAfter,
      };
      res.status(202).json(body);
    })();
  }
);

export { analyzeRouter };
