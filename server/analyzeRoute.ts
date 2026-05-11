// =============================================================
// /api/analyze — SGF upload + job enqueue (mock worker, in-memory store)
// =============================================================
//
// SECURITY NOTE: requireAnalyzeAuth 로 서버 측 인증 필수.
// 크레딧 차감은 서버(DB 또는 로컬 전용 메모리)에서만 수행한다.

import { nanoid } from "nanoid";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { AnalysisJobCreateResponse } from "@shared/analysisJob";
import { MAX_SGF_FILE_BYTES, SGF_UPLOAD_FORM_FIELD } from "@shared/const";
import { requireAnalyzeAuth } from "./middleware/requireAnalyzeAuth";
import { analysisJobStore } from "./inMemoryAnalysisJobStore";
import type { AnalysisJobLanguage } from "./analysisJobStore.types";
import { validateSgfText } from "./sgfValidation";
import {
  ensureWalletWithSignupBonus,
  refundCreditIfJobFailed,
  spendCreditForAnalysisJob,
  walletSubjectFromAuthUser,
} from "./creditService";

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

analyzeRouter.get("/api/analyze/:jobId", requireAnalyzeAuth, (req: Request, res: Response) => {
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

  const internal = analysisJobStore.getInternal(jobId);
  if (!internal) {
    res.status(404).json({
      success: false,
      message: "Job not found. It may have expired or the ID is invalid.",
    });
    return;
  }

  const viewer = walletSubjectFromAuthUser(user);
  if (internal.ownerClerkSubject !== viewer) {
    res.status(403).json({
      success: false,
      message: "이 분석 결과에 접근할 권한이 없습니다.",
    });
    return;
  }

  const row = analysisJobStore.toPublicGetResponse(jobId);
  if (!row) {
    res.status(404).json({ success: false, message: "Job not found. It may have expired or the ID is invalid." });
    return;
  }

  if (row.status === "completed" && row.meta?.mock) {
    res.set("X-KataTalk-Mock", "true");
  }
  res.json(row);
});

analyzeRouter.post(
  "/api/analyze",
  requireAnalyzeAuth,
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
        console.error("[analyze] ensureWallet", e);
        res.status(503).json({
          success: false,
          code: "CREDITS_UNAVAILABLE",
          message:
            "크레딧 지갑을 사용할 수 없습니다. 운영 환경에서는 DATABASE_URL 설정이 필요합니다.",
        });
        return;
      }

      const language = parseLanguage(req);
      const fileName = file.originalname.trim() || "uploaded.sgf";

      const jobId = nanoid();

      let spend: Awaited<ReturnType<typeof spendCreditForAnalysisJob>>;
      try {
        spend = await spendCreditForAnalysisJob(user, jobId, 1);
      } catch (e) {
        console.error("[analyze] spendCredit", e);
        res.status(503).json({
          success: false,
          code: "CREDITS_UNAVAILABLE",
          message:
            "크레딧 차감에 실패했습니다. 서버 설정(DATABASE_URL 등)을 확인해 주세요.",
        });
        return;
      }

      if (!spend.ok) {
        res.status(402).json({
          success: false,
          code: "INSUFFICIENT_CREDITS",
          message: "크레딧이 부족합니다. 크레딧을 충전한 뒤 다시 시도해 주세요.",
        });
        return;
      }

      try {
        analysisJobStore.createAndEnqueueMock({
          jobId,
          payload: { fileName, language },
          ownerClerkSubject: walletSubjectFromAuthUser(user),
          ownerAppUserId: user.id,
          creditLedgerId: spend.ledgerId,
          onJobFailed: () => refundCreditIfJobFailed(user, jobId, 1),
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

      const body: AnalysisJobCreateResponse = {
        success: true,
        jobId,
        status: "queued",
        creditBalance: spend.balanceAfter,
      };
      res.status(202).json(body);
    })();
  }
);

export { analyzeRouter };
