import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAnalysisPlanV1FromParsed,
  buildAnalysisPlanV1FromSgf,
  buildCandidateTurnsV1,
  buildEnrichedMovesFromParsed,
  selectCandidatesForMultiTurnAnalysis,
  sliceMovesBeforeTurnIndex,
} from "./analysisPlan";
import { parseMinimalSgfForSmoke } from "./worker/analysisEngines/katagoSgfQuery";

const SAMPLE_SGF_PATH = path.join(import.meta.dirname, "..", "samples", "test.sgf");

const LEARNING_EVENTS_SMOKE_SGF =
  "(;FF[4]GM[1]SZ[19]KM[6.5];B[pd];W[dp];B[pp];W[dd];B[fq];W[cn];B[qf];W[dc];B[cf];W[fc];B[jj];W[qq];B[qd];W[dq];B[oc];W[co];B[pc];W[cp];B[qn];W[dn];B[jp])";

function buildSgfWithNMoves(n: number, boardSize = 19): string {
  let s = `(;FF[4]GM[1]SZ[${boardSize}]KM[6.5]`;
  for (let i = 0; i < n; i++) {
    const c = i % 2 === 0 ? "B" : "W";
    const col = i % boardSize;
    const row = Math.floor(i / boardSize) % boardSize;
    const lc = String.fromCharCode("a".charCodeAt(0) + col);
    const lr = String.fromCharCode("a".charCodeAt(0) + row);
    s += `;${c}[${lc}${lr}]`;
  }
  return `${s})`;
}

describe("analysisPlan v1", () => {
  it("samples/test.sgf totalMoves is 2", () => {
    const raw = fs.readFileSync(SAMPLE_SGF_PATH, "utf8");
    const plan = buildAnalysisPlanV1FromSgf(raw);
    expect(plan.totalMoves).toBe(2);
    expect(plan.boardSize).toBe(19);
    expect(plan.version).toBe("analysis-plan-v1");
    expect(plan.candidateTurns.some(c => c.reason === "final_position" && c.turnIndex === 2)).toBe(true);
  });

  it("parses all moves and assigns turnIndex, player, gtpMove", () => {
    const sgf = "(;SZ[19];B[pd];W[ee];B[df])";
    const parsed = parseMinimalSgfForSmoke(sgf);
    const enriched = buildEnrichedMovesFromParsed(parsed);
    expect(enriched).toHaveLength(3);
    expect(enriched[0]).toMatchObject({ turnIndex: 1, player: "B", gtpMove: "Q16" });
    expect(enriched[1]).toMatchObject({ turnIndex: 2, player: "W", gtpMove: "E15" });
    expect(enriched[2]).toMatchObject({ turnIndex: 3, player: "B", gtpMove: "D14" });
  });

  it("keeps SGF column i (SGF uses literal i; GTP column skips I)", () => {
    const sgf = "(;SZ[19];B[ic])";
    const enriched = buildEnrichedMovesFromParsed(parseMinimalSgfForSmoke(sgf));
    expect(enriched[0]!.sgfPoint).toBe("ic");
    expect(enriched[0]!.gtpMove).toBe("J17");
  });

  it("handles pass moves (empty bracket and tt convention)", () => {
    const sgf = "(;SZ[9];B[];W[tt])";
    const enriched = buildEnrichedMovesFromParsed(parseMinimalSgfForSmoke(sgf));
    expect(enriched[0]!.gtpMove).toBe("pass");
    expect(enriched[1]!.gtpMove).toBe("pass");
  });

  it("never exceeds maxTurns and always keeps final_position when includeFinalPosition", () => {
    const sgf = buildSgfWithNMoves(220);
    const plan = buildAnalysisPlanV1FromSgf(sgf, { maxTurns: 10 });
    expect(plan.candidateTurns.length).toBeLessThanOrEqual(10);
    expect(plan.candidateTurns.some(c => c.reason === "final_position")).toBe(true);
    const finals = plan.candidateTurns.filter(c => c.reason === "final_position");
    expect(finals).toHaveLength(1);
    expect(finals[0]!.turnIndex).toBe(220);
  });

  it("includes final position in candidateTurns for multi-move game", () => {
    const sgf = buildSgfWithNMoves(45);
    const turns = buildCandidateTurnsV1(parseMinimalSgfForSmoke(sgf));
    const last = turns.find(c => c.turnIndex === 45);
    expect(last?.reason).toBe("final_position");
  });

  it("marks interval hits in opening as opening_sample", () => {
    const sgf = buildSgfWithNMoves(25);
    const turns = buildCandidateTurnsV1(parseMinimalSgfForSmoke(sgf));
    const t20 = turns.find(c => c.turnIndex === 20);
    expect(t20?.reason).toBe("opening_sample");
    const t25 = turns.find(c => c.turnIndex === 25);
    expect(t25?.reason).toBe("final_position");
  });

  it("keeps the learning events smoke fixture turn 20 as a non-final candidate", () => {
    const parsed = parseMinimalSgfForSmoke(LEARNING_EVENTS_SMOKE_SGF);
    const plan = buildAnalysisPlanV1FromParsed(parsed);
    expect(plan.totalMoves).toBe(21);

    const t20 = plan.candidateTurns.find(c => c.turnIndex === 20);
    expect(t20?.reason).toBe("opening_sample");
    expect(t20?.reason).not.toBe("final_position");

    const t21 = plan.candidateTurns.find(c => c.turnIndex === 21);
    expect(t21?.reason).toBe("final_position");
  });

  it("sliceMovesBeforeTurnIndex: turn N has movesBeforeCount N-1; turn 1 is empty", () => {
    const parsed = parseMinimalSgfForSmoke("(;SZ[19];B[pd];W[ee];B[df])");
    const t1 = sliceMovesBeforeTurnIndex(parsed, 1);
    expect(t1.movesBeforeCount).toBe(0);
    expect(t1.movesBefore).toHaveLength(0);
    expect(t1.playedMoveGtp).toBe("Q16");
    const t2 = sliceMovesBeforeTurnIndex(parsed, 2);
    expect(t2.movesBeforeCount).toBe(1);
    expect(t2.playedMoveGtp).toBe("E15");
    const t3 = sliceMovesBeforeTurnIndex(parsed, 3);
    expect(t3.movesBeforeCount).toBe(2);
    expect(t3.playedMoveGtp).toBe("D14");
  });

  it("playedMove from slice matches candidate gtpMove for each plan turn", () => {
    const parsed = parseMinimalSgfForSmoke("(;SZ[19];B[pd];W[ee];B[df])");
    const plan = buildAnalysisPlanV1FromParsed(parsed);
    for (const c of plan.candidateTurns) {
      const { playedMoveGtp } = sliceMovesBeforeTurnIndex(parsed, c.turnIndex);
      expect(playedMoveGtp).toBe(c.gtpMove);
    }
  });

  it("selectCandidatesForMultiTurnAnalysis caps count and puts final_position first", () => {
    const plan = buildAnalysisPlanV1FromParsed(parseMinimalSgfForSmoke(buildSgfWithNMoves(30)));
    const sel = selectCandidatesForMultiTurnAnalysis(plan, 4);
    expect(sel.length).toBeLessThanOrEqual(4);
    expect(sel[0]?.reason).toBe("final_position");
  });
});
