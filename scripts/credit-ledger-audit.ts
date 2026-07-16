import "dotenv/config";
import { getSupabaseAdmin } from "../server/_core/supabaseAdmin.ts";
import {
  buildCreditLedgerAuditReport,
  type CreditLedgerAnalysisJobRow,
  type CreditLedgerAuditReport,
  type CreditLedgerCreditLogRow,
  type CreditLedgerProfileRow,
} from "../server/creditLedgerAudit.ts";

type TableRead<T> = {
  rows: T[];
  total: number | null;
  complete: boolean;
};

const DEFAULT_LIMIT = 50_000;
const PAGE_SIZE = 1_000;

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function readBoolArg(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function readLimit(): number {
  const raw = readArg("limit") ?? process.env.CREDIT_AUDIT_LIMIT ?? "";
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(n, 200_000);
}

function maskId(value: string | undefined, showFull: boolean): string {
  if (!value) return "";
  if (showFull || value.length <= 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function readTable<T>(table: string, columns: string, limit: number): Promise<TableRead<T>> {
  const sb = getSupabaseAdmin();
  const rows: T[] = [];
  let total: number | null = null;
  let offset = 0;

  while (rows.length < limit) {
    const pageSize = Math.min(PAGE_SIZE, limit - rows.length);
    const { data, error, count } = await sb
      .from(table)
      .select(columns, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`${table} read failed: ${error.message}`);
    }
    if (typeof count === "number") {
      total = count;
    }

    const pageRows = (data ?? []) as T[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }
    if (total != null && rows.length >= total) {
      break;
    }
    offset += pageSize;
  }

  return {
    rows,
    total,
    complete: total == null ? rows.length < limit : rows.length >= total,
  };
}

async function readLedgerRows(limit: number): Promise<{
  profiles: TableRead<CreditLedgerProfileRow>;
  logs: TableRead<CreditLedgerCreditLogRow>;
  jobs: TableRead<CreditLedgerAnalysisJobRow>;
}> {
  const [profiles, logs, jobs] = await Promise.all([
    readTable<CreditLedgerProfileRow>("profiles", "id, credits, created_at", limit),
    readTable<CreditLedgerCreditLogRow>(
      "credit_logs",
      [
        "id",
        "user_id",
        "amount",
        "type",
        "payment_provider",
        "payment_event_id",
        "payment_order_id",
        "payment_checkout_id",
        "analysis_job_id",
        "idempotency_key",
        "created_at",
      ].join(", "),
      limit
    ),
    readTable<CreditLedgerAnalysisJobRow>(
      "analysis_jobs",
      "id, user_id, status, credit_cost, credit_log_id, created_at, updated_at, completed_at",
      limit
    ),
  ]);
  return { profiles, logs, jobs };
}

function printTextReport(report: CreditLedgerAuditReport, showFullIds: boolean): void {
  const status = report.ok ? "PASS" : "FAIL";
  console.log(`Credit ledger audit: ${status}`);
  console.log(`Generated at: ${report.generatedAt}`);
  console.log(
    `Rows: profiles=${report.counts.profiles}, logs=${report.counts.logs}, jobs=${report.counts.jobs}`
  );
  console.log(
    `Issues: failures=${report.counts.failures}, warnings=${report.counts.warnings}, total=${report.counts.issues}`
  );

  for (const issue of report.issues) {
    const head = issue.severity === "fail" ? "FAIL" : "WARN";
    const ids = [
      issue.userId ? `user=${maskId(issue.userId, showFullIds)}` : "",
      issue.jobId ? `job=${maskId(issue.jobId, showFullIds)}` : "",
      issue.logId ? `log=${maskId(issue.logId, showFullIds)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const details = issue.details ? ` details=${JSON.stringify(issue.details)}` : "";
    console.log(`[${head}] ${issue.code}${ids ? ` ${ids}` : ""} - ${issue.message}${details}`);
  }
}

async function main(): Promise<void> {
  const limit = readLimit();
  const json = readBoolArg("json");
  const showFullIds = readBoolArg("show-full-ids") || process.env.CREDIT_AUDIT_SHOW_FULL_IDS === "true";
  const { profiles, logs, jobs } = await readLedgerRows(limit);
  const report = buildCreditLedgerAuditReport(
    {
      profiles: profiles.rows,
      logs: logs.rows,
      jobs: jobs.rows,
    },
    {
      ledgerComplete: profiles.complete && logs.complete && jobs.complete,
      rowCounts: {
        profilesTotal: profiles.total,
        logsTotal: logs.total,
        jobsTotal: jobs.total,
      },
    }
  );

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report, showFullIds);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
