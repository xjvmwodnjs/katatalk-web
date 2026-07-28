import { getSupabaseAdmin } from "../_core/supabaseAdmin";

type QuarantineQueryResult = {
  data: unknown;
  count: number | null;
  error: unknown;
};

export type AnalysisFinalizationQuarantineQueryClient = {
  from: (table: string) => {
    select: (
      columns: string,
      options: { count: "exact" }
    ) => {
      is: (
        column: string,
        value: null
      ) => {
        order: (
          column: string,
          options: { ascending: true }
        ) => {
          limit: (count: number) => Promise<QuarantineQueryResult>;
        };
      };
    };
  };
};

export type AnalysisFinalizationQuarantineStatus =
  | {
      status: "clear";
      unresolvedCount: 0;
      oldestFirstFailedAt: null;
    }
  | {
      status: "attention_required";
      unresolvedCount: number;
      oldestFirstFailedAt: string;
    }
  | { status: "unknown" };

function validTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

export function quarantineStatusFromQueryResult(args: {
  data: unknown;
  count: unknown;
}): AnalysisFinalizationQuarantineStatus {
  if (
    !Number.isSafeInteger(args.count) ||
    (args.count as number) < 0 ||
    !Array.isArray(args.data)
  ) {
    return { status: "unknown" };
  }

  const unresolvedCount = args.count as number;
  if (unresolvedCount === 0) {
    return args.data.length === 0
      ? {
          status: "clear",
          unresolvedCount: 0,
          oldestFirstFailedAt: null,
        }
      : { status: "unknown" };
  }

  if (args.data.length !== 1) {
    return { status: "unknown" };
  }
  const row = args.data[0];
  const oldestFirstFailedAt =
    row && typeof row === "object"
      ? validTimestamp((row as Record<string, unknown>).first_failed_at)
      : null;
  if (!oldestFirstFailedAt) {
    return { status: "unknown" };
  }

  return {
    status: "attention_required",
    unresolvedCount,
    oldestFirstFailedAt,
  };
}

export async function getAnalysisFinalizationQuarantineStatus(
  args: {
    client?: AnalysisFinalizationQuarantineQueryClient;
  } = {}
): Promise<AnalysisFinalizationQuarantineStatus> {
  const client =
    args.client ??
    (getSupabaseAdmin() as unknown as AnalysisFinalizationQuarantineQueryClient);
  const { data, count, error } = await client
    .from("analysis_job_finalization_failures")
    .select("first_failed_at", { count: "exact" })
    .is("resolved_at", null)
    .order("first_failed_at", { ascending: true })
    .limit(1);

  if (error) {
    return { status: "unknown" };
  }
  return quarantineStatusFromQueryResult({ data, count });
}
