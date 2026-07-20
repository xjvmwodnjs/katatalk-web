import { describe, expect, it } from "vitest";
import {
  buildCreditLedgerAuditReport,
  type CreditLedgerAnalysisJobRow,
  type CreditLedgerCreditLogRow,
  type CreditLedgerProfileRow,
} from "./creditLedgerAudit";

function profile(overrides: Partial<CreditLedgerProfileRow> = {}): CreditLedgerProfileRow {
  return {
    id: "user_a",
    credits: 21,
    ...overrides,
  };
}

function log(overrides: Partial<CreditLedgerCreditLogRow> = {}): CreditLedgerCreditLogRow {
  return {
    id: "log_usage_job_a",
    user_id: "user_a",
    amount: -1,
    type: "usage",
    payment_provider: null,
    payment_event_id: null,
    payment_order_id: null,
    payment_checkout_id: null,
    analysis_job_id: "job_a",
    idempotency_key: "usage:job_a",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function job(overrides: Partial<CreditLedgerAnalysisJobRow> = {}): CreditLedgerAnalysisJobRow {
  return {
    id: "job_a",
    user_id: "user_a",
    status: "completed",
    credit_cost: 1,
    credit_log_id: "log_usage_job_a",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

describe("buildCreditLedgerAuditReport", () => {
  it("passes a balanced paid analysis ledger", () => {
    const report = buildCreditLedgerAuditReport(
      {
        profiles: [profile()],
        logs: [
          log({
            id: "log_signup",
            amount: 2,
            type: "signup_bonus",
            analysis_job_id: null,
            idempotency_key: "signup_bonus:user_a",
          }),
          log({
            id: "log_refill",
            amount: 20,
            type: "refill",
            payment_provider: "lemonsqueezy",
            payment_event_id: "order_1",
            payment_order_id: "order_1",
            payment_checkout_id: "checkout_1",
            analysis_job_id: null,
            idempotency_key: "payment:lemonsqueezy:order_1",
          }),
          log(),
        ],
        jobs: [job()],
      },
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("fails a failed paid job with usage but no refund", () => {
    const report = buildCreditLedgerAuditReport({
      profiles: [profile({ credits: 1 })],
      logs: [
        log({
          id: "log_signup",
          amount: 2,
          type: "signup_bonus",
          analysis_job_id: null,
          idempotency_key: "signup_bonus:user_a",
        }),
        log(),
      ],
      jobs: [job({ status: "failed" })],
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map(issue => issue.code)).toContain("FAILED_JOB_MISSING_REFUND");
  });

  it("accepts a failed paid job with one valid atomic refund ledger row", () => {
    const report = buildCreditLedgerAuditReport({
      profiles: [profile({ credits: 2 })],
      logs: [
        log({
          id: "log_signup",
          amount: 2,
          type: "signup_bonus",
          analysis_job_id: null,
          idempotency_key: "signup_bonus:user_a",
        }),
        log(),
        log({
          id: "log_atomic_refund",
          amount: 1,
          type: "refund",
          description: "Atomic analysis failure refund",
          analysis_job_id: "job_a",
          idempotency_key: "refund:job_a",
          metadata: {
            reason: "analysis_job_failed",
            error_code: "KATAGO_EXIT_NONZERO",
            worker_id: "worker-a",
            attempt_count: 2,
          },
        }),
      ],
      jobs: [job({ status: "failed" })],
    });

    expect(report.ok).toBe(true);
    expect(report.issues.map(issue => issue.code)).not.toContain("FAILED_JOB_MISSING_REFUND");
  });

  it("fails duplicate or wrong-amount refunds for one job", () => {
    const report = buildCreditLedgerAuditReport({
      profiles: [profile({ credits: 4 })],
      logs: [
        log({
          id: "log_signup",
          amount: 2,
          type: "signup_bonus",
          analysis_job_id: null,
          idempotency_key: "signup_bonus:user_a",
        }),
        log(),
        log({
          id: "log_refund_a",
          amount: 1,
          type: "refund",
          idempotency_key: "refund:job_a",
        }),
        log({
          id: "log_refund_b",
          amount: 2,
          type: "refund",
          idempotency_key: "manual-refund:job_a",
        }),
      ],
      jobs: [job({ status: "failed" })],
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["DUPLICATE_REFUND_LOG_FOR_JOB", "REFUND_AMOUNT_MISMATCH"]));
  });

  it("fails when profile credits differ from the complete ledger sum", () => {
    const report = buildCreditLedgerAuditReport({
      profiles: [profile({ credits: 99 })],
      logs: [
        log({
          id: "log_signup",
          amount: 2,
          type: "signup_bonus",
          analysis_job_id: null,
          idempotency_key: "signup_bonus:user_a",
        }),
      ],
      jobs: [],
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PROFILE_CREDIT_MISMATCH",
          details: { profileCredits: 99, ledgerSum: 2 },
        }),
      ])
    );
  });

  it("detects duplicate provider payment order ids", () => {
    const report = buildCreditLedgerAuditReport({
      profiles: [profile({ credits: 40 })],
      logs: [
        log({
          id: "log_refill_a",
          amount: 20,
          type: "refill",
          payment_provider: "lemonsqueezy",
          payment_event_id: "event_a",
          payment_order_id: "same_order",
          payment_checkout_id: "checkout_a",
          analysis_job_id: null,
          idempotency_key: "payment:lemonsqueezy:event_a",
        }),
        log({
          id: "log_refill_b",
          amount: 20,
          type: "refill",
          payment_provider: "lemonsqueezy",
          payment_event_id: "event_b",
          payment_order_id: "same_order",
          payment_checkout_id: "checkout_b",
          analysis_job_id: null,
          idempotency_key: "payment:lemonsqueezy:event_b",
        }),
      ],
      jobs: [],
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map(issue => issue.code)).toContain("DUPLICATE_PAYMENT_ORDER");
  });

  it("warns and skips profile balance checks when the ledger is incomplete", () => {
    const report = buildCreditLedgerAuditReport(
      {
        profiles: [profile({ credits: 99 })],
        logs: [],
        jobs: [],
      },
      { ledgerComplete: false, rowCounts: { profilesTotal: 10, logsTotal: 100, jobsTotal: 50 } }
    );

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([
      expect.objectContaining({
        severity: "warn",
        code: "AUDIT_LIMIT_REACHED",
      }),
    ]);
  });
});
