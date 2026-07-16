export type CreditLedgerAuditSeverity = "warn" | "fail";

export type CreditLedgerAuditIssueCode =
  | "AUDIT_LIMIT_REACHED"
  | "PROFILE_CREDIT_MISMATCH"
  | "NEGATIVE_PROFILE_CREDITS"
  | "LOG_WITHOUT_PROFILE"
  | "JOB_WITHOUT_PROFILE"
  | "INVALID_LOG_AMOUNT"
  | "JOB_CREDIT_LOG_MISSING"
  | "JOB_CREDIT_LOG_NOT_FOUND"
  | "JOB_CREDIT_LOG_INVALID"
  | "USAGE_LOG_WITHOUT_JOB_ID"
  | "USAGE_LOG_WITHOUT_JOB"
  | "REFUND_LOG_WITHOUT_JOB_ID"
  | "REFUND_LOG_WITHOUT_JOB"
  | "FAILED_JOB_MISSING_REFUND"
  | "NON_FAILED_JOB_HAS_REFUND"
  | "PAYMENT_REFILL_MISSING_PROVIDER"
  | "PAYMENT_REFILL_MISSING_STABLE_ID"
  | "DUPLICATE_PAYMENT_EVENT"
  | "DUPLICATE_PAYMENT_ORDER";

export type CreditLedgerAuditIssue = {
  severity: CreditLedgerAuditSeverity;
  code: CreditLedgerAuditIssueCode;
  message: string;
  userId?: string;
  jobId?: string;
  logId?: string;
  details?: Record<string, string | number | boolean | null>;
};

export type CreditLedgerProfileRow = {
  id: string;
  credits: number;
};

export type CreditLedgerCreditLogRow = {
  id: string;
  user_id: string;
  amount: number;
  type: string;
  payment_provider: string | null;
  payment_event_id: string | null;
  payment_order_id: string | null;
  payment_checkout_id: string | null;
  analysis_job_id: string | null;
  idempotency_key: string | null;
  created_at?: string | null;
};

export type CreditLedgerAnalysisJobRow = {
  id: string;
  user_id: string;
  status: string;
  credit_cost: number;
  credit_log_id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

export type CreditLedgerAuditInput = {
  profiles: CreditLedgerProfileRow[];
  logs: CreditLedgerCreditLogRow[];
  jobs: CreditLedgerAnalysisJobRow[];
};

export type CreditLedgerAuditOptions = {
  generatedAt?: string;
  ledgerComplete?: boolean;
  rowCounts?: {
    profilesTotal?: number | null;
    logsTotal?: number | null;
    jobsTotal?: number | null;
  };
};

export type CreditLedgerAuditReport = {
  ok: boolean;
  generatedAt: string;
  counts: {
    profiles: number;
    logs: number;
    jobs: number;
    issues: number;
    warnings: number;
    failures: number;
  };
  issues: CreditLedgerAuditIssue[];
};

function addIssue(
  issues: CreditLedgerAuditIssue[],
  issue: CreditLedgerAuditIssue
): void {
  issues.push(issue);
}

function groupPush<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
}

function hasPaymentIdempotency(log: CreditLedgerCreditLogRow): boolean {
  return (log.idempotency_key ?? "").startsWith("payment:");
}

function isPaymentRefill(log: CreditLedgerCreditLogRow): boolean {
  return log.type === "refill" && (hasPaymentIdempotency(log) || Boolean(log.payment_provider));
}

function isPositiveCreditType(type: string): boolean {
  return type === "signup_bonus" || type === "refill" || type === "refund";
}

export function buildCreditLedgerAuditReport(
  input: CreditLedgerAuditInput,
  options: CreditLedgerAuditOptions = {}
): CreditLedgerAuditReport {
  const issues: CreditLedgerAuditIssue[] = [];
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const ledgerComplete = options.ledgerComplete ?? true;

  const profilesById = new Map(input.profiles.map(profile => [profile.id, profile]));
  const logsById = new Map(input.logs.map(log => [log.id, log]));
  const jobsById = new Map(input.jobs.map(job => [job.id, job]));
  const logsByUser = new Map<string, CreditLedgerCreditLogRow[]>();
  const logsByAnalysisJobId = new Map<string, CreditLedgerCreditLogRow[]>();
  const paymentEventGroups = new Map<string, CreditLedgerCreditLogRow[]>();
  const paymentOrderGroups = new Map<string, CreditLedgerCreditLogRow[]>();

  if (!ledgerComplete) {
    addIssue(issues, {
      severity: "warn",
      code: "AUDIT_LIMIT_REACHED",
      message: "Audit read limit was reached; balance reconciliation is skipped because rows may be incomplete.",
      details: {
        profilesRead: input.profiles.length,
        logsRead: input.logs.length,
        jobsRead: input.jobs.length,
        profilesTotal: options.rowCounts?.profilesTotal ?? null,
        logsTotal: options.rowCounts?.logsTotal ?? null,
        jobsTotal: options.rowCounts?.jobsTotal ?? null,
      },
    });
  }

  for (const profile of input.profiles) {
    if (profile.credits < 0) {
      addIssue(issues, {
        severity: "fail",
        code: "NEGATIVE_PROFILE_CREDITS",
        message: "Profile has a negative credit balance.",
        userId: profile.id,
        details: { credits: profile.credits },
      });
    }
  }

  for (const log of input.logs) {
    groupPush(logsByUser, log.user_id, log);
    if (log.analysis_job_id) {
      groupPush(logsByAnalysisJobId, log.analysis_job_id, log);
    }

    if (!profilesById.has(log.user_id)) {
      addIssue(issues, {
        severity: "fail",
        code: "LOG_WITHOUT_PROFILE",
        message: "Credit log references a missing profile.",
        userId: log.user_id,
        logId: log.id,
      });
    }

    if (!Number.isInteger(log.amount) || log.amount === 0) {
      addIssue(issues, {
        severity: "fail",
        code: "INVALID_LOG_AMOUNT",
        message: "Credit log amount must be a non-zero integer.",
        userId: log.user_id,
        logId: log.id,
        details: { amount: log.amount },
      });
    } else if (log.type === "usage" && log.amount >= 0) {
      addIssue(issues, {
        severity: "fail",
        code: "INVALID_LOG_AMOUNT",
        message: "Usage credit log must be negative.",
        userId: log.user_id,
        logId: log.id,
        details: { amount: log.amount },
      });
    } else if (isPositiveCreditType(log.type) && log.amount <= 0) {
      addIssue(issues, {
        severity: "fail",
        code: "INVALID_LOG_AMOUNT",
        message: "Credit grant or refund log must be positive.",
        userId: log.user_id,
        logId: log.id,
        details: { amount: log.amount, type: log.type },
      });
    }

    if (log.type === "usage") {
      if (!log.analysis_job_id) {
        addIssue(issues, {
          severity: "fail",
          code: "USAGE_LOG_WITHOUT_JOB_ID",
          message: "Usage credit log is missing analysis_job_id.",
          userId: log.user_id,
          logId: log.id,
        });
      } else if (!jobsById.has(log.analysis_job_id)) {
        addIssue(issues, {
          severity: "fail",
          code: "USAGE_LOG_WITHOUT_JOB",
          message: "Usage credit log references a missing analysis job.",
          userId: log.user_id,
          jobId: log.analysis_job_id,
          logId: log.id,
        });
      }
    }

    if (log.type === "refund") {
      if (!log.analysis_job_id) {
        addIssue(issues, {
          severity: "fail",
          code: "REFUND_LOG_WITHOUT_JOB_ID",
          message: "Refund credit log is missing analysis_job_id.",
          userId: log.user_id,
          logId: log.id,
        });
      } else if (!jobsById.has(log.analysis_job_id)) {
        addIssue(issues, {
          severity: "fail",
          code: "REFUND_LOG_WITHOUT_JOB",
          message: "Refund credit log references a missing analysis job.",
          userId: log.user_id,
          jobId: log.analysis_job_id,
          logId: log.id,
        });
      }
    }

    if (isPaymentRefill(log)) {
      if (!log.payment_provider) {
        addIssue(issues, {
          severity: "fail",
          code: "PAYMENT_REFILL_MISSING_PROVIDER",
          message: "Payment refill is missing payment_provider.",
          userId: log.user_id,
          logId: log.id,
        });
      }
      if (!log.payment_event_id && !log.payment_order_id && !log.payment_checkout_id) {
        addIssue(issues, {
          severity: "fail",
          code: "PAYMENT_REFILL_MISSING_STABLE_ID",
          message: "Payment refill is missing event/order/checkout identifiers.",
          userId: log.user_id,
          logId: log.id,
        });
      }
      if (log.payment_provider && log.payment_event_id) {
        groupPush(paymentEventGroups, `${log.payment_provider}:${log.payment_event_id}`, log);
      }
      if (log.payment_provider && log.payment_order_id) {
        groupPush(paymentOrderGroups, `${log.payment_provider}:${log.payment_order_id}`, log);
      }
    }
  }

  for (const [key, group] of Array.from(paymentEventGroups.entries())) {
    if (group.length > 1) {
      addIssue(issues, {
        severity: "fail",
        code: "DUPLICATE_PAYMENT_EVENT",
        message: "Multiple refill logs share the same provider payment event id.",
        userId: group[0]?.user_id,
        logId: group[0]?.id,
        details: { paymentEventKey: key, duplicateCount: group.length },
      });
    }
  }

  for (const [key, group] of Array.from(paymentOrderGroups.entries())) {
    if (group.length > 1) {
      addIssue(issues, {
        severity: "fail",
        code: "DUPLICATE_PAYMENT_ORDER",
        message: "Multiple refill logs share the same provider payment order id.",
        userId: group[0]?.user_id,
        logId: group[0]?.id,
        details: { paymentOrderKey: key, duplicateCount: group.length },
      });
    }
  }

  for (const job of input.jobs) {
    if (!profilesById.has(job.user_id)) {
      addIssue(issues, {
        severity: "fail",
        code: "JOB_WITHOUT_PROFILE",
        message: "Analysis job references a missing profile.",
        userId: job.user_id,
        jobId: job.id,
      });
    }

    const linkedLog = job.credit_log_id ? logsById.get(job.credit_log_id) : null;
    if (job.credit_cost > 0) {
      if (!job.credit_log_id) {
        addIssue(issues, {
          severity: "fail",
          code: "JOB_CREDIT_LOG_MISSING",
          message: "Paid analysis job is missing credit_log_id.",
          userId: job.user_id,
          jobId: job.id,
          details: { creditCost: job.credit_cost, status: job.status },
        });
      } else if (!linkedLog) {
        addIssue(issues, {
          severity: "fail",
          code: "JOB_CREDIT_LOG_NOT_FOUND",
          message: "Analysis job credit_log_id does not exist in credit_logs.",
          userId: job.user_id,
          jobId: job.id,
          logId: job.credit_log_id,
        });
      } else if (
        linkedLog.type !== "usage" ||
        linkedLog.analysis_job_id !== job.id ||
        linkedLog.user_id !== job.user_id
      ) {
        addIssue(issues, {
          severity: "fail",
          code: "JOB_CREDIT_LOG_INVALID",
          message: "Analysis job credit_log_id does not point to the matching usage log.",
          userId: job.user_id,
          jobId: job.id,
          logId: job.credit_log_id,
        });
      }
    }

    const jobLogs = logsByAnalysisJobId.get(job.id) ?? [];
    const hasUsageLog = jobLogs.some(log => log.type === "usage");
    const hasRefundLog = jobLogs.some(log => log.type === "refund");
    if (job.status === "failed" && job.credit_cost > 0 && hasUsageLog && !hasRefundLog) {
      addIssue(issues, {
        severity: "fail",
        code: "FAILED_JOB_MISSING_REFUND",
        message: "Failed paid analysis job has a usage log but no refund log.",
        userId: job.user_id,
        jobId: job.id,
      });
    }
    if (job.status !== "failed" && hasRefundLog) {
      addIssue(issues, {
        severity: "warn",
        code: "NON_FAILED_JOB_HAS_REFUND",
        message: "Non-failed analysis job has a refund log.",
        userId: job.user_id,
        jobId: job.id,
        details: { status: job.status },
      });
    }
  }

  if (ledgerComplete) {
    for (const profile of input.profiles) {
      const ledgerSum = (logsByUser.get(profile.id) ?? []).reduce((sum, log) => sum + log.amount, 0);
      if (ledgerSum !== profile.credits) {
        addIssue(issues, {
          severity: "fail",
          code: "PROFILE_CREDIT_MISMATCH",
          message: "Profile credits do not match summed credit_logs amount.",
          userId: profile.id,
          details: { profileCredits: profile.credits, ledgerSum },
        });
      }
    }
  }

  const failures = issues.filter(issue => issue.severity === "fail").length;
  const warnings = issues.filter(issue => issue.severity === "warn").length;
  return {
    ok: failures === 0,
    generatedAt,
    counts: {
      profiles: input.profiles.length,
      logs: input.logs.length,
      jobs: input.jobs.length,
      issues: issues.length,
      warnings,
      failures,
    },
    issues,
  };
}
