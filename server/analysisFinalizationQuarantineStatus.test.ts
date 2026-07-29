import { describe, expect, it, vi } from "vitest";
import {
  getAnalysisFinalizationQuarantineStatus,
  quarantineStatusFromQueryResult,
  type AnalysisFinalizationQuarantineQueryClient,
} from "./worker/analysisFinalizationQuarantineStatus";

function queryClient(result: {
  data: unknown;
  count: number | null;
  error: unknown;
}) {
  const limit = vi.fn(async () => result);
  const order = vi.fn(() => ({ limit }));
  const is = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ is }));
  const from = vi.fn(() => ({ select }));
  return {
    client: { from } as AnalysisFinalizationQuarantineQueryClient,
    from,
    select,
    is,
    order,
    limit,
  };
}

describe("analysis finalization quarantine status", () => {
  it("selects only the oldest unresolved timestamp with an exact count", async () => {
    const query = queryClient({
      data: [{ first_failed_at: "2026-07-20T00:00:00.000Z" }],
      count: 2,
      error: null,
    });

    await expect(
      getAnalysisFinalizationQuarantineStatus({ client: query.client })
    ).resolves.toEqual({
      status: "attention_required",
      unresolvedCount: 2,
      oldestFirstFailedAt: "2026-07-20T00:00:00.000Z",
    });
    expect(query.from).toHaveBeenCalledWith(
      "analysis_job_finalization_failures"
    );
    expect(query.select).toHaveBeenCalledWith("first_failed_at", {
      count: "exact",
    });
    expect(query.is).toHaveBeenCalledWith("resolved_at", null);
    expect(query.order).toHaveBeenCalledWith("first_failed_at", {
      ascending: true,
    });
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it("maps an empty unresolved set to clear", async () => {
    const query = queryClient({ data: [], count: 0, error: null });

    await expect(
      getAnalysisFinalizationQuarantineStatus({ client: query.client })
    ).resolves.toEqual({
      status: "clear",
      unresolvedCount: 0,
      oldestFirstFailedAt: null,
    });
  });

  it.each([
    { data: [], count: null },
    { data: [], count: -1 },
    { data: [], count: 1.5 },
    { data: [{ first_failed_at: "not-a-time" }], count: 1 },
    { data: [], count: 1 },
    { data: [{ first_failed_at: "2026-07-20T00:00:00.000Z" }], count: 0 },
  ])("fails closed for malformed count or row data: %o", ({ data, count }) => {
    expect(quarantineStatusFromQueryResult({ data, count })).toEqual({
      status: "unknown",
    });
  });

  it("drops database error details", async () => {
    const query = queryClient({
      data: null,
      count: null,
      error: { message: "database-host-and-row-detail" },
    });

    await expect(
      getAnalysisFinalizationQuarantineStatus({ client: query.client })
    ).resolves.toEqual({ status: "unknown" });
  });
});
