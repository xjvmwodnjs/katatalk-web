import { describe, expect, it } from "vitest";
import { refundCreditIfJobFailedByProfileId } from "./creditService";

describe("refundCreditIfJobFailedByProfileId", () => {
  it("returns ok=true on successful refund RPC", async () => {
    const r = await refundCreditIfJobFailedByProfileId("user_a", "job-refund-ok", 1);
    expect(r).toEqual({ ok: true, duplicate: false });
  });

  it("returns duplicate=true when RPC marks duplicate", async () => {
    const r = await refundCreditIfJobFailedByProfileId("user_a", "job-refund-dup", 1);
    expect(r).toEqual({ ok: true, duplicate: true });
  });

  it("returns ok=false on RPC transport error", async () => {
    const r = await refundCreditIfJobFailedByProfileId("user_a", "job-refund-rpc-error", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe("RPC_ERROR");
      expect(r.errorMessage).toContain("rpc simulated");
    }
  });

  it("returns ok=false with reason code when RPC declines (NO_SPEND)", async () => {
    const r = await refundCreditIfJobFailedByProfileId("user_a", "job-refund-no-spend", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe("NO_SPEND");
    }
  });
});
