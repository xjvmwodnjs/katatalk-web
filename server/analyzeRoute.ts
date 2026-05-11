// =============================================================
// /api/analyze — SGF upload + job enqueue (mock worker, in-memory store)
// =============================================================
//
// SECURITY NOTE:
// This route is intentionally public for the local demo. A commercial service
// must move analysis behind protectedProcedure or equivalent auth middleware,
// validate SGF uploads, enforce quota server-side, and enqueue a KataGo worker.

import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { AnalysisJobCreateResponse } from "@shared/analysisJob";
import { MAX_SGF_FILE_BYTES, SGF_UPLOAD_FORM_FIELD } from "@shared/const";
import { analysisJobStore } from "./inMemoryAnalysisJobStore";
import type { AnalysisJobLanguage } from "./analysisJobStore.types";
import { validateSgfText } from "./sgfValidation";

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

analyzeRouter.get("/api/analyze/:jobId", (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  if (!jobId || typeof jobId !== "string") {
    sendUploadError(res, 400, "Missing job ID.");
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
  handleMulterUpload,
  (req: Request, res: Response) => {
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

    const language = parseLanguage(req);
    const fileName = file.originalname.trim() || "uploaded.sgf";

    // TODO(KataGo): enqueue onto durable queue + worker instead of in-memory mock pipeline.
    const jobId = analysisJobStore.createAndEnqueueMock({
      fileName,
      language,
      sgfContent,
    });

    const body: AnalysisJobCreateResponse = {
      success: true,
      jobId,
      status: "queued",
    };
    res.status(202).json(body);
  }
);

export { analyzeRouter };
