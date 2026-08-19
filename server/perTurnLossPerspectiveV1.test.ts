import { describe, expect, it } from "vitest";
import { hasVerifiedPerTurnLossPerspectiveV1 } from "../shared/perTurnLossPerspectiveV1";

describe("hasVerifiedPerTurnLossPerspectiveV1", () => {
  it("fails closed for legacy success rows without comparison metadata", () => {
    expect(
      hasVerifiedPerTurnLossPerspectiveV1([
        {
          status: "ok",
          turnIndex: 3,
          player: "W",
          playedMove: "Q16",
          moveSummary: { played: { move: "Q16", winrate: 0.48 } },
        },
      ] as never)
    ).toBe(false);
  });

  it("requires at least one scored row with verified axis evidence", () => {
    expect(
      hasVerifiedPerTurnLossPerspectiveV1([
        {
          status: "ok",
          turnIndex: 3,
          player: "W",
          playedMove: "Q16",
          comparisonReady: { playedMoveFoundInCandidates: false },
        },
      ] as never)
    ).toBe(false);
  });

  it("rejects a scored legacy row whose perspective is missing", () => {
    expect(
      hasVerifiedPerTurnLossPerspectiveV1([
        {
          status: "ok",
          turnIndex: 3,
          player: "W",
          playedMove: "Q16",
          comparisonReady: { playedMoveFoundInCandidates: true },
          moveSummary: {
            best: { move: "D4", scoreLead: -2 },
            played: { move: "Q16", scoreLead: 1 },
          },
        },
      ] as never)
    ).toBe(false);
  });

  it("accepts a scored row only when its loss perspective is verified", () => {
    expect(
      hasVerifiedPerTurnLossPerspectiveV1([
        {
          status: "ok",
          turnIndex: 3,
          player: "W",
          playedMove: "Q16",
          comparisonReady: { playedMoveFoundInCandidates: true },
          moveSummary: {
            best: { move: "D4", scoreLead: -2, winrate: 0.4 },
            played: { move: "Q16", scoreLead: 1, winrate: 0.6 },
          },
          lossPerspective: {
            version: "per-turn-loss-perspective-v1",
            configuredPerspective: "black",
            playerToMove: "W",
            status: "verified",
          },
        },
      ] as never)
    ).toBe(true);
  });

  it("fails the whole artifact when verified and provisional scored rows are mixed", () => {
    const verified = {
      status: "ok",
      turnIndex: 3,
      player: "W",
      playedMove: "Q16",
      comparisonReady: { playedMoveFoundInCandidates: true },
      moveSummary: {
        best: { move: "D4", scoreLead: -2 },
        played: { move: "Q16", scoreLead: 1 },
      },
      lossPerspective: {
        version: "per-turn-loss-perspective-v1",
        configuredPerspective: "black",
        playerToMove: "W",
        status: "verified",
      },
    };
    const provisional = {
      ...verified,
      turnIndex: 5,
      lossPerspective: undefined,
    };

    expect(
      hasVerifiedPerTurnLossPerspectiveV1([verified, provisional] as never)
    ).toBe(false);
  });
});
