// =============================================================
// Home Page: KataTalk — Upload + Analysis Results only (no pricing)
// =============================================================

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  getLoginUrl,
  getSignUpUrl,
  persistUiLang,
  readStoredUiLang,
  KATATALK_UI_LANG_EVENT,
} from "@/const";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, User, LogIn, UserPlus, Crown, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  MOCK_DATA,
  TRANSLATIONS,
  Language,
  type AnalysisReport,
} from "@/lib/mockData";
import type {
  AnalysisJobGetResponse,
  WinrateTimelineProgressResponseV1,
} from "@shared/analysisJob";
import {
  isKatagoWorkerV1ResultPayload,
  normalizeAnalysisJobStatus,
  parseStoredAnalysisJobResult,
} from "@shared/analysisJob";
import { getAnalyzeAuthHeaders } from "@/lib/analyzeAuthHeaders";
import {
  buildAnalysisJobSearch,
  buildSearchWithoutAnalysisJob,
  clearStoredAnalysisJobId,
  readAnalysisJobIdFromSearch,
  readStoredAnalysisJobId,
  searchHasBillingStatus,
  writeStoredAnalysisJobId,
} from "@/lib/analysisJobDeepLink";
import { MAX_SGF_FILE_BYTES, SGF_UPLOAD_FORM_FIELD } from "@shared/const";
import LanguageSelector from "@/components/LanguageSelector";
import type { KatagoWorkerV1ResultData } from "@/components/KatagoWorkerV1ResultPanel";
import AnalysisResultView from "@/components/AnalysisResultView";
import AnalysisWinratePanel from "@/components/AnalysisWinratePanel";
import UploadHero from "@/components/UploadHero";
import { normalizeWinratePerspectiveV1 } from "@shared/winratePerspectiveV1";
import type { AnalysisResultWinratePointV1 } from "@shared/analysisResultViewModel";

type View = "upload" | "loading" | "result";

const POLL_INTERVAL_MS = 1_000;
const TIMELINE_POLL_INTERVAL_MS = 2_000;
const RATE_LIMIT_BACKOFF_MS = 5_000;
const POLL_MAX_MS = 20 * 60_000;
const ANALYSIS_POLL_TIMEOUT_NAME = "AnalysisPollTimeout";

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function buildAnalysisPollTimeoutError(lang: Language): Error {
  const message =
    lang === "ko"
      ? "분석이 아직 진행 중입니다. 이 결과 링크를 열어두거나 나중에 다시 확인해 주세요."
      : lang === "en"
        ? "The analysis is still running. Keep this result link or check it again later."
        : lang === "zh"
          ? "分析仍在进行中。请保留此结果链接，稍后再查看。"
          : "解析はまだ実行中です。この結果リンクを残して、あとで再確認してください。";
  const err = new Error(message);
  err.name = ANALYSIS_POLL_TIMEOUT_NAME;
  return err;
}

function isAnalysisPollTimeout(error: unknown): error is Error {
  return error instanceof Error && error.name === ANALYSIS_POLL_TIMEOUT_NAME;
}

function analysisStillRunningTitle(lang: Language): string {
  return lang === "ko"
    ? "분석이 계속 진행 중입니다."
    : lang === "en"
      ? "Analysis is still running."
      : lang === "zh"
        ? "分析仍在进行中。"
        : "解析はまだ実行中です。";
}

export default function Home() {
  const { user, isAuthenticated, loading: authLoading, logout } = useAuth();
  const [lang, setLang] = useState<Language>(() => readStoredUiLang());
  const [view, setView] = useState<View>("upload");
  const [report, setReport] = useState<AnalysisReport>(MOCK_DATA);
  const [katagoWorkerV1Result, setKatagoWorkerV1Result] =
    useState<KatagoWorkerV1ResultData | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobStatus, setJobStatus] = useState<
    AnalysisJobGetResponse["status"] | "idle"
  >("idle");
  const [resultJobId, setResultJobId] = useState<string | null>(null);
  const [deletingResultData, setDeletingResultData] = useState(false);
  const [timelineProgressSeries, setTimelineProgressSeries] = useState<
    AnalysisResultWinratePointV1[]
  >([]);
  const [timelineProgressStats, setTimelineProgressStats] = useState<{
    completedCount: number;
    totalPoints: number | null;
  }>({
    completedCount: 0,
    totalPoints: null,
  });
  const pollAbortRef = useRef(false);
  const t = TRANSLATIONS[lang];

  useEffect(() => {
    return () => {
      pollAbortRef.current = true;
    };
  }, []);

  useEffect(() => {
    const syncLang = () => setLang(readStoredUiLang());
    window.addEventListener(KATATALK_UI_LANG_EVENT, syncLang);
    return () => window.removeEventListener(KATATALK_UI_LANG_EVENT, syncLang);
  }, []);

  const utils = trpc.useUtils();

  function browserStorage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function replaceCurrentSearch(search: string): void {
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname || "/"}${search}${window.location.hash}`
    );
  }

  function rememberActiveAnalysisJob(jobId: string): void {
    writeStoredAnalysisJobId(browserStorage(), jobId);
    replaceCurrentSearch(buildAnalysisJobSearch(window.location.search, jobId));
  }

  function forgetActiveAnalysisJob(jobId?: string): void {
    const storage = browserStorage();
    if (jobId) {
      const storedJobId = readStoredAnalysisJobId(storage);
      if (storedJobId && storedJobId !== jobId) {
        return;
      }
    }
    clearStoredAnalysisJobId(storage);
  }

  function clearAnalysisJobFromUrl(): void {
    replaceCurrentSearch(buildSearchWithoutAnalysisJob(window.location.search));
  }

  async function pollTimelineProgress(jobId: string): Promise<boolean> {
    const res = await fetch(
      `/api/analyze/${encodeURIComponent(jobId)}/timeline-progress`,
      {
        credentials: "include",
        headers: { ...(await getAnalyzeAuthHeaders()) },
      }
    );
    if (res.status === 404) {
      return false;
    }
    if (!res.ok) {
      return true;
    }
    const body = (await res
      .json()
      .catch(() => null)) as WinrateTimelineProgressResponseV1 | null;
    if (!body?.success || !Array.isArray(body.points)) {
      return true;
    }
    const series: AnalysisResultWinratePointV1[] = [];
    for (const p of body.points) {
      if (typeof p.winrate !== "number" || !Number.isFinite(p.winrate)) {
        continue;
      }
      const perspective = normalizeWinratePerspectiveV1({
        rawWinrate: p.winrate,
        turnIndex: p.turnIndex,
        player: null,
        currentPlayer: p.currentPlayer,
        playerToMove: p.currentPlayer,
        configuredPerspective: p.winratePerspective,
      });
      series.push({
        turnIndex: p.turnIndex,
        player: null,
        rawWinrate: perspective.rawWinrate,
        displayWinrate: perspective.normalized.displayWinrate,
        displayPerspective: perspective.rawPerspective,
        currentPlayer: p.currentPlayer,
        playerToMove: p.currentPlayer,
        confidence:
          perspective.normalized.status === "verified"
            ? "verified"
            : "provisional",
        timelineStatus: p.isDuringSearch ? "partial" : "final",
        perspective,
      });
    }
    series.sort((a, b) => a.turnIndex - b.turnIndex);
    setTimelineProgressSeries(series);
    setTimelineProgressStats({
      completedCount: body.completedCount,
      totalPoints: body.totalPoints,
    });
    return true;
  }

  useEffect(() => {
    if (authLoading) return;
    const search = window.location.search;
    const jobIdFromUrl = readAnalysisJobIdFromSearch(search);
    const storedJobId =
      !jobIdFromUrl && !searchHasBillingStatus(search)
        ? readStoredAnalysisJobId(browserStorage())
        : null;
    const jobId = jobIdFromUrl ?? storedJobId;
    if (!jobId) return;
    if (!jobIdFromUrl && storedJobId) {
      replaceCurrentSearch(buildAnalysisJobSearch(search, storedJobId));
    }

    let cancelled = false;
    pollAbortRef.current = false;
    setKatagoWorkerV1Result(null);
    setResultJobId(null);
    setTimelineProgressSeries([]);
    setTimelineProgressStats({ completedCount: 0, totalPoints: null });
    setJobProgress(0);
    setJobStatus("queued");
    setView("loading");

    void (async () => {
      try {
        if (!isAuthenticated) {
          throw new Error(
            lang === "ko"
              ? "결과를 보려면 로그인이 필요합니다."
              : lang === "en"
                ? "Please log in to view this analysis result."
                : lang === "zh"
                  ? "请登录后查看分析结果。"
                  : "解析結果を見るにはログインが必要です。"
          );
        }

        const deadline = Date.now() + POLL_MAX_MS;
        let timelineProgressAvailable = true;
        let nextTimelineProgressAt = 0;
        while (!cancelled && !pollAbortRef.current && Date.now() < deadline) {
          const pollRes = await fetch(
            `/api/analyze/${encodeURIComponent(jobId)}`,
            {
              credentials: "include",
              headers: { ...(await getAnalyzeAuthHeaders()) },
            }
          );
          const pollBody = (await pollRes.json().catch(() => ({}))) as
            | AnalysisJobGetResponse
            | { success?: false; message?: string };

          if (pollRes.status === 429) {
            await sleep(RATE_LIMIT_BACKOFF_MS);
            continue;
          }

          if (!pollRes.ok || pollBody.success === false) {
            const msg =
              "message" in pollBody && typeof pollBody.message === "string"
                ? pollBody.message
                : `Job status request failed (${pollRes.status})`;
            throw new Error(msg);
          }

          const job = pollBody as AnalysisJobGetResponse;
          const normalizedStatus = normalizeAnalysisJobStatus(
            String(job.status)
          );
          setJobStatus(normalizedStatus);
          setJobProgress(typeof job.progress === "number" ? job.progress : 0);
          if (
            (normalizedStatus === "queued" || normalizedStatus === "running") &&
            timelineProgressAvailable &&
            Date.now() >= nextTimelineProgressAt
          ) {
            timelineProgressAvailable = await pollTimelineProgress(jobId);
            nextTimelineProgressAt = Date.now() + TIMELINE_POLL_INTERVAL_MS;
          }

          if (normalizedStatus === "completed") {
            const parsed = parseStoredAnalysisJobResult(job.data);
            if (parsed == null) {
              throw new Error("Analysis finished but no data was returned.");
            }
            if (isKatagoWorkerV1ResultPayload(parsed)) {
              setKatagoWorkerV1Result(parsed as KatagoWorkerV1ResultData);
            } else {
              setKatagoWorkerV1Result(null);
              setReport(parsed as AnalysisReport);
            }
            forgetActiveAnalysisJob(jobId);
            setResultJobId(jobId);
            setView("result");
            setJobStatus("idle");
            return;
          }

          if (normalizedStatus === "failed") {
            forgetActiveAnalysisJob(jobId);
            clearAnalysisJobFromUrl();
            throw new Error(job.error?.message ?? "Analysis job failed.");
          }

          await sleep(POLL_INTERVAL_MS);
        }

        if (!cancelled && !pollAbortRef.current) {
          throw buildAnalysisPollTimeoutError(lang);
        }
      } catch (error: any) {
        if (cancelled) return;
        if (isAnalysisPollTimeout(error)) {
          setView("loading");
          setJobStatus(prev => (prev === "idle" ? "running" : prev));
          toast.message(analysisStillRunningTitle(lang), {
            description: error.message,
          });
          return;
        }
        setView("upload");
        setJobStatus("idle");
        setJobProgress(0);
        toast.error(
          lang === "ko"
            ? "분석 결과를 불러오지 못했습니다."
            : lang === "en"
              ? "Could not load the analysis result."
              : lang === "zh"
                ? "无法加载分析结果。"
                : "解析結果を読み込めませんでした。",
          { description: error.message }
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, lang]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;

    if (billing === "cancel") {
      toast.message(TRANSLATIONS[lang].billingCancelled);
      window.history.replaceState({}, "", window.location.pathname || "/");
      return;
    }

    if (billing !== "success") return;

    let cancelled = false;
    const POLL_MS = 2000;
    const MAX_MS = 30_000;

    void (async () => {
      const bt = TRANSLATIONS[lang];
      const h = await getAnalyzeAuthHeaders().catch(() => null as null);
      if (!h) {
        toast.error(bt.billingCreditsRefreshError);
        window.history.replaceState({}, "", window.location.pathname || "/");
        return;
      }

      const baselineStored = sessionStorage.getItem(
        "katatalk_billing_baseline_credits"
      );
      sessionStorage.removeItem("katatalk_billing_baseline_credits");

      const hadStoredBaseline =
        baselineStored != null &&
        baselineStored !== "" &&
        !Number.isNaN(Number(baselineStored));

      async function readCredits(): Promise<number | null> {
        const r = await fetch("/api/credits/me", {
          headers: { ...h },
          credentials: "include",
        });
        if (!r.ok) return null;
        const j = (await r.json()) as { credits?: unknown };
        return typeof j.credits === "number" ? j.credits : null;
      }

      type CreditLogLite = {
        type?: unknown;
        amount?: unknown;
        created_at?: unknown;
        payment_provider?: unknown;
      };

      async function readCreditLogs(): Promise<CreditLogLite[]> {
        const r = await fetch("/api/credits/logs", {
          headers: { ...h },
          credentials: "include",
        });
        if (!r.ok) return [];
        const j = (await r.json()) as { logs?: unknown };
        return Array.isArray(j.logs) ? (j.logs as CreditLogLite[]) : [];
      }

      const REFILL_LOOKBACK_MS = 15 * 60 * 1000;

      function hasRecentRefill(
        logs: CreditLogLite[],
        withinMs: number
      ): boolean {
        const now = Date.now();
        for (const log of logs) {
          if (log.type !== "refill") continue;
          if (typeof log.amount !== "number" || log.amount <= 0) continue;
          const t = log.created_at;
          if (typeof t !== "string") continue;
          const ts = Date.parse(t);
          if (!Number.isFinite(ts) || now - ts > withinMs) continue;
          return true;
        }
        return false;
      }

      const c0 = await readCredits();
      if (cancelled || c0 === null) {
        toast.error(bt.billingCreditsCheckFail, {
          description: bt.pricingCheckoutFailedDesc,
        });
        await utils.profile.getSubscription.invalidate();
        window.history.replaceState({}, "", window.location.pathname || "/");
        return;
      }

      if (!hadStoredBaseline) {
        const logsEarly = await readCreditLogs();
        if (hasRecentRefill(logsEarly, REFILL_LOOKBACK_MS)) {
          toast.success(bt.billingPaidTitle, {
            description: bt.billingCreditMaybeAppliedDesc,
          });
          await utils.profile.getSubscription.invalidate();
          window.history.replaceState({}, "", window.location.pathname || "/");
          return;
        }
      }

      let baseline: number;
      if (hadStoredBaseline) {
        baseline = Number(baselineStored);
      } else {
        baseline = c0;
      }

      if (c0 > baseline) {
        toast.success(bt.billingPaidTitle, {
          description: bt.billingCreditsAppliedNotice,
        });
        await utils.profile.getSubscription.invalidate();
        window.history.replaceState({}, "", window.location.pathname || "/");
        return;
      }

      const deadline = Date.now() + MAX_MS;
      while (!cancelled && Date.now() < deadline) {
        await sleep(POLL_MS);
        const c = await readCredits();
        if (c !== null && c > baseline) {
          toast.success(bt.billingPaidTitle, {
            description: bt.billingCreditsAppliedNotice,
          });
          await utils.profile.getSubscription.invalidate();
          window.history.replaceState({}, "", window.location.pathname || "/");
          return;
        }
      }

      if (!cancelled) {
        if (!hadStoredBaseline) {
          const logsLate = await readCreditLogs();
          if (hasRecentRefill(logsLate, REFILL_LOOKBACK_MS)) {
            toast.message(bt.billingCreditMaybeAppliedTitle, {
              description: bt.billingCreditMaybeAppliedDesc,
            });
          } else {
            toast.message(bt.billingCreditPendingNeutralTitle, {
              description: bt.billingCreditPendingNeutralDesc,
            });
          }
        } else {
          toast.message(bt.billingCreditDelayedMessage);
        }
        await utils.profile.getSubscription.invalidate();
        window.history.replaceState({}, "", window.location.pathname || "/");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, utils, lang]);

  // Fetch subscription info if authenticated
  const { data: subscription } = trpc.profile.getSubscription.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
    }
  );
  const creditBalance =
    subscription?.creditBalance ?? subscription?.remainingAnalysisCount ?? 0;

  const handleLogin = () => {
    window.location.href = getLoginUrl();
  };

  const handleSignUp = () => {
    window.location.href = getSignUpUrl();
  };

  const handleLogout = async () => {
    await logout();
    toast.success(t.logoutSuccess);
  };

  // Auth Guard: block upload for unauthenticated users
  const handleAnalyzeRequest = async (file: File) => {
    if (!isAuthenticated) {
      toast.error(t.loginRequired, {
        description:
          lang === "ko"
            ? "기보 분석은 로그인 후 이용 가능합니다."
            : lang === "en"
              ? "Please log in to use the analysis feature."
              : lang === "zh"
                ? "请登录后使用分析功能。"
                : "分析機能をご利用いただくにはログインが必要です。",
        action: {
          label: t.login,
          onClick: handleLogin,
        },
      });
      return;
    }

    const analyzeAuth = await getAnalyzeAuthHeaders();
    const needBearer =
      import.meta.env.VITE_AUTH_PROVIDER === "supabase" ||
      import.meta.env.VITE_AUTH_PROVIDER === "clerk";
    if (needBearer) {
      const hasBearer =
        typeof analyzeAuth === "object" &&
        analyzeAuth !== null &&
        "Authorization" in analyzeAuth &&
        Boolean((analyzeAuth as Record<string, string>).Authorization);
      if (!hasBearer) {
        toast.error("로그인이 필요합니다.", {
          description: "세션이 없거나 만료되었습니다. 다시 로그인해 주세요.",
          action: { label: t.login, onClick: handleLogin },
        });
        return;
      }
    }

    if (file.size > MAX_SGF_FILE_BYTES) {
      toast.error(
        lang === "ko"
          ? "파일이 너무 큽니다."
          : lang === "en"
            ? "File is too large."
            : lang === "zh"
              ? "文件太大。"
              : "ファイルが大きすぎます。",
        {
          description:
            lang === "ko"
              ? `SGF는 최대 ${MAX_SGF_FILE_BYTES / (1024 * 1024)}MB까지 업로드할 수 있습니다.`
              : lang === "en"
                ? `SGF uploads are limited to ${MAX_SGF_FILE_BYTES / (1024 * 1024)} MB.`
                : lang === "zh"
                  ? `SGF 文件最大 ${MAX_SGF_FILE_BYTES / (1024 * 1024)} MB。`
                  : `SGFは最大${MAX_SGF_FILE_BYTES / (1024 * 1024)}MBまでです。`,
        }
      );
      return;
    }

    pollAbortRef.current = false;
    setKatagoWorkerV1Result(null);
    setResultJobId(null);
    setTimelineProgressSeries([]);
    setTimelineProgressStats({ completedCount: 0, totalPoints: null });
    setJobProgress(0);
    setJobStatus("queued");
    setView("loading");
    try {
      const formData = new FormData();
      formData.append(SGF_UPLOAD_FORM_FIELD, file);
      formData.append("language", lang);

      const response = await fetch("/api/analyze", {
        method: "POST",
        credentials: "include",
        headers: { ...analyzeAuth },
        body: formData,
      });

      const createPayload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        jobId?: string;
        status?: string;
        message?: string;
        code?: string;
        creditBalance?: number;
        remainingCredits?: number;
      };

      if (
        response.status === 402 ||
        createPayload.code === "INSUFFICIENT_CREDITS"
      ) {
        throw new Error(
          typeof createPayload.message === "string" &&
          createPayload.message.trim()
            ? createPayload.message
            : "크레딧이 부족합니다. 크레딧을 충전한 뒤 다시 시도해 주세요."
        );
      }

      if (
        !response.ok ||
        createPayload.success === false ||
        !createPayload.jobId
      ) {
        const msg =
          typeof createPayload.message === "string" &&
          createPayload.message.trim()
            ? createPayload.message
            : !response.ok
              ? response.status === 401
                ? "로그인이 필요합니다. 다시 로그인한 뒤 시도해 주세요."
                : `분석을 시작할 수 없습니다 (${response.status})`
              : "분석을 시작할 수 없습니다.";
        throw new Error(msg);
      }

      if (
        typeof createPayload.creditBalance === "number" ||
        typeof createPayload.remainingCredits === "number"
      ) {
        void utils.profile.getSubscription.invalidate();
      }

      const jobId = createPayload.jobId;
      rememberActiveAnalysisJob(jobId);
      const deadline = Date.now() + POLL_MAX_MS;
      let timelineProgressAvailable = true;
      let nextTimelineProgressAt = 0;

      while (!pollAbortRef.current && Date.now() < deadline) {
        const pollRes = await fetch(
          `/api/analyze/${encodeURIComponent(jobId)}`,
          {
            credentials: "include",
            headers: { ...(await getAnalyzeAuthHeaders()) },
          }
        );

        const pollBody = (await pollRes.json().catch(() => ({}))) as
          | AnalysisJobGetResponse
          | { success?: false; message?: string };

        if (pollRes.status === 429) {
          await sleep(RATE_LIMIT_BACKOFF_MS);
          continue;
        }

        if (!pollRes.ok || pollBody.success === false) {
          const msg =
            "message" in pollBody && typeof pollBody.message === "string"
              ? pollBody.message
              : `Job status request failed (${pollRes.status})`;
          throw new Error(msg);
        }

        const job = pollBody as AnalysisJobGetResponse;
        const normalizedStatus = normalizeAnalysisJobStatus(String(job.status));
        setJobStatus(normalizedStatus);
        setJobProgress(typeof job.progress === "number" ? job.progress : 0);
        if (
          (normalizedStatus === "queued" || normalizedStatus === "running") &&
          timelineProgressAvailable &&
          Date.now() >= nextTimelineProgressAt
        ) {
          timelineProgressAvailable = await pollTimelineProgress(jobId);
          nextTimelineProgressAt = Date.now() + TIMELINE_POLL_INTERVAL_MS;
        }

        if (normalizedStatus === "completed") {
          const parsed = parseStoredAnalysisJobResult(job.data);
          if (parsed == null) {
            throw new Error("Analysis finished but no data was returned.");
          }
          if (isKatagoWorkerV1ResultPayload(parsed)) {
            setKatagoWorkerV1Result(parsed as KatagoWorkerV1ResultData);
          } else {
            setKatagoWorkerV1Result(null);
            setReport(parsed as AnalysisReport);
          }
          forgetActiveAnalysisJob(jobId);
          setResultJobId(jobId);
          setView("result");
          setJobStatus("idle");
          toast.success(
            lang === "ko"
              ? "분석이 완료되었습니다!"
              : lang === "en"
                ? "Analysis complete!"
                : lang === "zh"
                  ? "分析完成！"
                  : "分析が完了しました！"
          );
          return;
        }

        if (normalizedStatus === "failed") {
          forgetActiveAnalysisJob(jobId);
          clearAnalysisJobFromUrl();
          throw new Error(job.error?.message ?? "Analysis job failed.");
        }

        await sleep(POLL_INTERVAL_MS);
      }

      if (pollAbortRef.current) {
        return;
      }
      throw buildAnalysisPollTimeoutError(lang);
    } catch (error: any) {
      if (isAnalysisPollTimeout(error)) {
        setView("loading");
        setJobStatus(prev => (prev === "idle" ? "running" : prev));
        toast.message(analysisStillRunningTitle(lang), {
          description: error.message,
        });
        return;
      }
      setView("upload");
      setJobStatus("idle");
      setJobProgress(0);
      toast.error(
        lang === "ko"
          ? "분석 중 오류가 발생했습니다."
          : lang === "en"
            ? "An error occurred during analysis."
            : lang === "zh"
              ? "分析过程中发生错误。"
              : "分析中にエラーが発生しました。",
        { description: error.message }
      );
    }
  };

  const handleDeleteResultData = async () => {
    if (!resultJobId || deletingResultData) return;
    const confirmed = window.confirm(
      lang === "ko"
        ? "이 분석의 기보 원문과 결과를 삭제할까요? 삭제한 데이터는 복구할 수 없습니다."
        : "Delete this analysis source and result? Deleted data cannot be restored."
    );
    if (!confirmed) return;

    setDeletingResultData(true);
    try {
      const response = await fetch(`/api/analyze/${encodeURIComponent(resultJobId)}/data`, {
        method: "DELETE",
        credentials: "include",
        headers: { ...(await getAnalyzeAuthHeaders()) },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Delete failed (${response.status})`);
      }
      setKatagoWorkerV1Result(null);
      setResultJobId(null);
      clearAnalysisJobFromUrl();
      setView("upload");
      toast.success(lang === "ko" ? "분석 데이터가 삭제되었습니다." : "Analysis data deleted.");
    } catch (error) {
      toast.error(lang === "ko" ? "분석 데이터를 삭제하지 못했습니다." : "Could not delete analysis data.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeletingResultData(false);
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "oklch(0.13 0.005 285)" }}
    >
      {/* ─── Top Navigation Bar ─── */}
      <header
        className="sticky top-0 z-40 border-b"
        style={{
          background: "rgba(16, 16, 22, 0.92)",
          borderColor: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div className="container flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity">
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #C9A84C, #8B6914)",
                }}
              >
                <span
                  className="text-xs font-bold text-black"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  AI
                </span>
              </div>
              <span
                className="text-sm font-semibold text-amber-100 hidden sm:block"
                style={{ fontFamily: "'Noto Serif KR', serif" }}
              >
                KataTalk
              </span>
            </div>
          </Link>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <>
                {/* User Profile Badge */}
                <div
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(201, 168, 76, 0.2)" }}
                  >
                    <User className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <span
                    className="text-xs font-medium text-amber-200"
                    style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
                  >
                    {authLoading &&
                    isAuthenticated &&
                    !(user?.name || user?.email)
                      ? "…"
                      : user?.name || user?.email || "User"}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{
                      background: "rgba(201, 168, 76, 0.15)",
                      color: "#C9A84C",
                    }}
                  >
                    {lang === "ko"
                      ? `크레딧 ${creditBalance}`
                      : lang === "en"
                        ? `Credits ${creditBalance}`
                        : lang === "zh"
                          ? `积分 ${creditBalance}`
                          : `クレジット ${creditBalance}`}
                  </span>
                </div>

                {/* Logout */}
                <button
                  onClick={handleLogout}
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
                  style={{
                    color: "#cbd5e1",
                    fontFamily: "'Noto Sans KR', sans-serif",
                  }}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t.logout}
                </button>
              </>
            ) : (
              <>
                {/* Login */}
                <button
                  onClick={handleLogin}
                  type="button"
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
                  style={{
                    color: "#cbd5e1",
                    fontFamily: "'Noto Sans KR', sans-serif",
                  }}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  {t.login}
                </button>

                {/* Signup */}
                <button
                  onClick={handleSignUp}
                  type="button"
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    color: "#f1f5f9",
                    fontFamily: "'Noto Sans KR', sans-serif",
                  }}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {t.signup}
                </button>
              </>
            )}

            {/* Credit top-up → /pricing (Lemon Squeezy), 비로그인 시 로그인 안내 */}
            {isAuthenticated ? (
              <Link href="/pricing">
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
                  style={{
                    background: "linear-gradient(135deg, #C9A84C, #A08030)",
                    color: "#0c0a09",
                    boxShadow: "0 2px 12px rgba(201, 168, 76, 0.25)",
                    fontFamily: "'Noto Sans KR', sans-serif",
                  }}
                >
                  <Crown className="w-3.5 h-3.5" />
                  {t.subscribe}
                </button>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  toast.info(t.loginRequired);
                  window.location.href = getLoginUrl();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 opacity-70"
                style={{
                  background: "linear-gradient(135deg, #C9A84C, #A08030)",
                  color: "#0c0a09",
                  boxShadow: "0 2px 12px rgba(201, 168, 76, 0.25)",
                  fontFamily: "'Noto Sans KR', sans-serif",
                }}
              >
                <Crown className="w-3.5 h-3.5" />
                {t.subscribe}
              </button>
            )}

            {/* Divider */}
            <div
              className="w-px h-5 mx-1"
              style={{ background: "rgba(255,255,255,0.1)" }}
            />

            {/* Language Selector */}
            <LanguageSelector
              current={lang}
              onChange={next => {
                setLang(next);
                persistUiLang(next);
              }}
            />
          </div>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main className="container">
        {view === "upload" ? (
          <>
            {!isAuthenticated && (
              <div
                className="max-w-lg mx-auto mb-8 mt-6 rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                style={{
                  background: "rgba(254, 243, 199, 0.12)",
                  border: "1px solid rgba(250, 204, 21, 0.35)",
                  boxShadow: "0 0 0 1px rgba(0,0,0,0.04) inset",
                }}
              >
                <div
                  className="text-sm text-amber-50 font-medium"
                  style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
                >
                  {lang === "ko"
                    ? "기보 분석은 로그인한 뒤 이용할 수 있습니다."
                    : lang === "en"
                      ? "Sign in to run SGF analysis."
                      : lang === "zh"
                        ? "登录后即可进行棋谱分析。"
                        : "棋譜分析にはログインが必要です。"}
                </div>
                <button
                  type="button"
                  onClick={handleLogin}
                  className="shrink-0 min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900/80"
                  style={{
                    background: "linear-gradient(135deg, #C9A84C, #A08030)",
                    color: "#0c0a09",
                    fontFamily: "'Noto Sans KR', sans-serif",
                  }}
                >
                  {t.login}
                </button>
              </div>
            )}
            {/* Upload Hero Section with Auth Guard */}
            <UploadHero
              t={t}
              onAnalyze={handleAnalyzeRequest}
              isAuthenticated={isAuthenticated}
              onLoginRequired={() => {
                toast.error(t.loginRequired, {
                  description:
                    lang === "ko"
                      ? "기보 분석은 로그인 후 이용 가능합니다."
                      : lang === "en"
                        ? "Please log in to use the analysis feature."
                        : lang === "zh"
                          ? "请登录后使用分析功能。"
                          : "分析機能をご利用いただくにはログインが必要です。",
                  action: {
                    label: t.login,
                    onClick: handleLogin,
                  },
                });
              }}
            />

            {/* Profile Summary (only for authenticated users) */}
            {isAuthenticated && (
              <div className="max-w-lg mx-auto mb-12">
                <div
                  className="rounded-xl px-5 py-4 flex items-center justify-between"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{
                        background: "rgba(201, 168, 76, 0.15)",
                        border: "1px solid rgba(201, 168, 76, 0.3)",
                      }}
                    >
                      <User className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <div
                        className="text-xs text-slate-500"
                        style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
                      >
                        {t.profilePlan}
                      </div>
                      <div
                        className="text-sm font-semibold text-amber-200"
                        style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
                      >
                        {lang === "ko"
                          ? `보유 크레딧 ${creditBalance}`
                          : lang === "en"
                            ? `Credits: ${creditBalance}`
                            : lang === "zh"
                              ? `积分: ${creditBalance}`
                              : `クレジット: ${creditBalance}`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-xs text-slate-500"
                      style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
                    >
                      {t.profileRemaining}
                    </div>
                    <div
                      className="text-lg font-bold text-amber-300"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {lang === "ko"
                        ? "1 분석 = 1"
                        : lang === "en"
                          ? "1 analysis = 1"
                          : lang === "zh"
                            ? "1 次分析 = 1"
                            : "1 解析 = 1"}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : view === "loading" ? (
          /* ─── Loading State ─── */
          <section className="py-20 md:py-32 flex flex-col items-center justify-center">
            <div className="relative mb-8">
              {/* Animated Go stone ring */}
              <div className="w-24 h-24 rounded-full border-4 border-amber-400/30 animate-pulse" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="w-12 h-12 rounded-full animate-spin"
                  style={{
                    background:
                      "conic-gradient(from 0deg, transparent 0%, #C9A84C 50%, transparent 100%)",
                  }}
                />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="w-8 h-8 rounded-full"
                  style={{ background: "oklch(0.13 0.005 285)" }}
                />
              </div>
            </div>
            <h3
              className="text-xl font-bold text-amber-100 mb-2"
              style={{ fontFamily: "'Noto Serif KR', serif" }}
            >
              {t.analyzing}
            </h3>
            <p
              className="text-sm text-slate-400 text-center max-w-sm"
              style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
            >
              {jobStatus === "queued"
                ? lang === "ko"
                  ? "분석 작업이 대기열에 올라갔습니다. 곧 시작합니다…"
                  : lang === "en"
                    ? "Your analysis job is queued and will start shortly…"
                    : lang === "zh"
                      ? "分析任务已排队，即将开始…"
                      : "解析ジョブはキューに入りました。まもなく開始します…"
                : lang === "ko"
                  ? "KataGo AI가 기보를 분석하고 있습니다. 잠시만 기다려 주세요…"
                  : lang === "en"
                    ? "KataGo AI is analyzing your game. Please wait…"
                    : lang === "zh"
                      ? "KataGo AI正在分析棋谱，请稍候…"
                      : "KataGo AIが棋譜を分析中です。しばらくお待ちください…"}
            </p>
            <div
              className="mt-6 w-64 max-w-[85vw] h-1.5 rounded-full overflow-hidden mx-auto"
              style={{ background: "rgba(255,255,255,0.08)" }}
              aria-valuenow={jobProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              role="progressbar"
            >
              <div
                className="h-full rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.min(100, Math.max(0, jobProgress))}%`,
                  background: "linear-gradient(90deg, #C9A84C, #E8D48B)",
                }}
              />
            </div>
            <p
              className="mt-2 text-xs text-slate-500 text-center font-mono"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {jobStatus !== "idle"
                ? `${jobStatus} · ${Math.round(jobProgress)}%`
                : ""}
            </p>
            <div className="mt-6 w-full max-w-3xl">
              <AnalysisWinratePanel
                series={timelineProgressSeries}
                selectedTurnIndex={null}
                onSelectTurnIndex={() => undefined}
                lang={lang}
                fullTimeline
                collapsed={false}
                progressStatus={{
                  isRunning: jobStatus === "queued" || jobStatus === "running",
                  completedCount: timelineProgressStats.completedCount,
                  totalPoints: timelineProgressStats.totalPoints,
                }}
              />
            </div>
            <div className="mt-6 flex gap-1.5">
              {[0, 1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-amber-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </section>
        ) : (
          <>
            {/* Back to Upload button */}
            <div className="pt-6 flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  setKatagoWorkerV1Result(null);
                  setResultJobId(null);
                  forgetActiveAnalysisJob();
                  clearAnalysisJobFromUrl();
                  setView("upload");
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:bg-white/5"
                style={{
                  color: "#94a3b8",
                  border: "1px solid rgba(255,255,255,0.08)",
                  fontFamily: "'Noto Sans KR', sans-serif",
                }}
              >
                <ArrowLeft className="w-4 h-4" />
                {t.backToUpload}
              </button>
              {resultJobId && (
                <button
                  type="button"
                  onClick={handleDeleteResultData}
                  disabled={deletingResultData}
                  aria-label={lang === "ko" ? "분석 데이터 삭제" : "Delete analysis data"}
                  title={lang === "ko" ? "분석 데이터 삭제" : "Delete analysis data"}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border text-rose-300 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderColor: "rgba(251,113,133,0.35)" }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Analysis Results — ViewModel v1 (KataGo / mock-legacy / unknown) */}
            <div className="py-6 md:py-10">
              <AnalysisResultView
                data={katagoWorkerV1Result ?? (report as unknown)}
                lang={lang}
              />
            </div>
          </>
        )}

        {/* Footer */}
        <footer
          className="py-8 border-t text-center"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <p
            className="text-xs text-slate-600"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {t.footerPowered}
          </p>
          <p
            className="text-xs text-slate-700 mt-1"
            style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
          >
            {t.footerDisclaimer}
          </p>
        </footer>
      </main>
    </div>
  );
}
