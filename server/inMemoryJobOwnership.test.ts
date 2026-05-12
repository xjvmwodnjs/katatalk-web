import { describe, expect, it } from "vitest";
import { InMemoryAnalysisJobStore } from "./inMemoryAnalysisJobStore";

describe("InMemoryAnalysisJobStore ownership", () => {
  it("stores owner clerk subject on job", () => {
    const store = new InMemoryAnalysisJobStore();
    store.createAndEnqueueMock({
      jobId: "jid-owner",
      payload: { fileName: "x.sgf", language: "ko" },
      ownerClerkSubject: "user_sub_abc",
      ownerAppUserId: 5,
      creditLedgerId: "00000000-0000-0000-0000-000000000099",
    });
    const internal = store.getInternal("jid-owner");
    expect(internal?.ownerClerkSubject).toBe("user_sub_abc");
    expect(internal?.ownerAppUserId).toBe(5);
  });
});
