import { describe, expect, it } from "vitest";
import type { ExplanationPlanV1 } from "@shared/explanationPlannerV1";
import { LLM_COMMENTARY_GUARD_V1_VERSION } from "@shared/llmCommentaryGuardV1";
import {
  runLlmCommentaryOrchestratorV1,
  type LlmCommentaryFunctionV1,
} from "@shared/llmCommentaryOrchestratorV1";

const basePlan: ExplanationPlanV1 = {
  version: "explanation-planner-v1",
  targetType: "review_move",
  turnIndex: 32,
  player: "B",
  titleKey: "ep_title_review_move_candidate",
  summaryKey: "ep_summary_review_learning_candidate",
  severity: "medium",
  confidence: "medium",
  evidenceBullets: [
    {
      type: "score_loss",
      labelKey: "ep_evidence_score_loss",
      value: 3.5,
      unit: "points",
      textKey: "ep_text_score_loss_candidate",
    },
    {
      type: "winrate_loss",
      labelKey: "ep_evidence_winrate_loss",
      value: 0.12,
      unit: "ratio",
      textKey: "ep_text_winrate_loss_candidate",
    },
  ],
  referenceLine: {
    playedMove: "D4",
    recommendedMove: "Q16",
    pv: ["Q16", "D16", "pass"],
  },
  caveats: ["ep_caveat_candidate_not_final_judgement"],
  forbiddenLabelSafe: true,
};

const safeOutput = {
  version: LLM_COMMENTARY_GUARD_V1_VERSION,
  title: "검토 후보 장면",
  body: "D4 이후 Q16 참고 수순을 보며 3.5집, 12% 근거를 함께 확인합니다.",
  bullets: ["PV에는 Q16과 D16이 포함됩니다."],
  caveat: "후보 신뢰도는 확정 판정이 아닙니다.",
};

function fakeLlm(output: unknown, calls: { count: number }): LlmCommentaryFunctionV1 {
  return () => {
    calls.count += 1;
    return output;
  };
}

describe("llm commentary orchestrator v1", () => {
  it("returns ok for valid plan and safe output", async () => {
    const calls = { count: 0 };
    const result = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 19,
      llm: fakeLlm(safeOutput, calls),
    });
    expect(result.status).toBe("ok");
    expect(result.reasonCode).toBeNull();
    expect(result.commentary).toEqual(safeOutput);
    expect(result.usedLlm).toBe(true);
    expect(calls.count).toBe(1);
  });

  it("does not call llm and falls back for invalid plan", async () => {
    const calls = { count: 0 };
    const invalidPlan = {
      ...basePlan,
      evidenceBullets: [{ ...basePlan.evidenceBullets[0], unit: "none" }],
    } as ExplanationPlanV1;
    const result = await runLlmCommentaryOrchestratorV1({
      plan: invalidPlan,
      boardSize: 19,
      llm: fakeLlm(safeOutput, calls),
    });
    expect(result.status).toBe("fallback");
    expect(result.reasonCode).toBe("input_guard_invalid_evidence_invariant");
    expect(result.commentary).toBeNull();
    expect(result.fallbackPlan).toEqual({
      version: "explanation-planner-v1",
      targetType: "review_move",
      turnIndex: 0,
      player: null,
      titleKey: "ep_title_fallback",
      summaryKey: "ep_summary_fallback",
      severity: "low",
      confidence: "low",
      evidenceBullets: [],
      referenceLine: {
        playedMove: null,
        recommendedMove: null,
        pv: [],
      },
      caveats: ["fallback"],
      forbiddenLabelSafe: true,
    });
    expect(result.usedLlm).toBe(false);
    expect(calls.count).toBe(0);
  });

  it("does not copy raw SGF from invalid input into fallbackPlan", async () => {
    const calls = { count: 0 };
    const result = await runLlmCommentaryOrchestratorV1({
      plan: { ...basePlan, caveats: ["(;GM[1]FF[4]SZ[19];B[dd];W[qq])"] },
      boardSize: 19,
      llm: fakeLlm(safeOutput, calls),
    });
    expect(result.status).toBe("fallback");
    expect(JSON.stringify(result.fallbackPlan)).not.toContain("(;GM[1]");
    expect(calls.count).toBe(0);
  });

  it("does not copy env or path-like strings from invalid input into fallbackPlan", async () => {
    const calls = { count: 0 };
    const result = await runLlmCommentaryOrchestratorV1({
      plan: { ...basePlan, caveats: ["SUPABASE_SERVICE_ROLE_KEY=C:/Users/example/secret"] },
      boardSize: 19,
      llm: fakeLlm(safeOutput, calls),
    });
    const serialized = JSON.stringify(result.fallbackPlan);
    expect(result.status).toBe("fallback");
    expect(serialized).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(serialized).not.toContain("C:/Users");
    expect(calls.count).toBe(0);
  });

  it("does not copy forbidden labels from invalid input into fallbackPlan", async () => {
    const calls = { count: 0 };
    const result = await runLlmCommentaryOrchestratorV1({
      plan: { ...basePlan, caveats: ["패착 확정"] },
      boardSize: 19,
      llm: fakeLlm(safeOutput, calls),
    });
    expect(result.status).toBe("fallback");
    expect(JSON.stringify(result.fallbackPlan)).not.toContain("패착 확정");
    expect(calls.count).toBe(0);
  });

  it("does not call llm when boardSize is invalid", async () => {
    const calls = { count: 0 };
    const result = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 17,
      llm: fakeLlm(safeOutput, calls),
    });
    expect(result.status).toBe("fallback");
    expect(result.reasonCode).toBe("invalid_board_size");
    expect(result.usedLlm).toBe(false);
    expect(result.commentary).toBeNull();
    expect(calls.count).toBe(0);
  });

  it("falls back when llm throws", async () => {
    const result = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 19,
      llm: () => {
        throw new Error("fake llm failure");
      },
    });
    expect(result.status).toBe("fallback");
    expect(result.reasonCode).toBe("llm_throw");
    expect(result.usedLlm).toBe(false);
  });

  it("falls back on forbidden label output", async () => {
    const calls = { count: 0 };
    const result = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 19,
      llm: fakeLlm({ ...safeOutput, body: "이 장면은 패착 확정입니다." }, calls),
    });
    expect(result.status).toBe("fallback");
    expect(result.reasonCode).toBe("output_guard_forbidden_label");
    expect(result.usedLlm).toBe(false);
    expect(calls.count).toBe(1);
  });

  it("falls back on unsafe payload output", async () => {
    const result = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 19,
      llm: () => ({ ...safeOutput, body: "(;GM[1]FF[4]SZ[19];B[dd];W[qq])" }),
    });
    expect(result.status).toBe("fallback");
    expect(result.reasonCode).toBe("output_guard_unsafe_string_payload");
    expect(result.usedLlm).toBe(false);
  });

  it("falls back on coordinate not present in plan", async () => {
    const result = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 19,
      llm: () => ({ ...safeOutput, body: "R17도 비교합니다." }),
    });
    expect(result.status).toBe("fallback");
    expect(result.reasonCode).toBe("claim_verifier_unknown_coordinate_claim");
  });

  it("falls back on score not present in plan", async () => {
    const result = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 19,
      llm: () => ({ ...safeOutput, body: "D4 이후 7집 차이를 언급합니다." }),
    });
    expect(result.status).toBe("fallback");
    expect(result.reasonCode).toBe("claim_verifier_unknown_score_claim");
  });

  it("falls back on I-column coordinate output", async () => {
    const result = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 19,
      llm: () => ({ ...safeOutput, body: "I9도 비교합니다." }),
    });
    expect(result.status).toBe("fallback");
    expect(result.reasonCode).toBe("claim_verifier_unknown_coordinate_claim");
  });

  it("falls back on out-of-board coordinate output", async () => {
    const result = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 13,
      llm: () => ({ ...safeOutput, body: "T19도 참고합니다." }),
    });
    expect(result.status).toBe("fallback");
    expect(result.reasonCode).toBe("claim_verifier_unknown_coordinate_claim");
  });

  it("sets usedLlm=true only for safe accepted output", async () => {
    const ok = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 19,
      llm: () => safeOutput,
    });
    const fallback = await runLlmCommentaryOrchestratorV1({
      plan: basePlan,
      boardSize: 19,
      llm: () => ({ ...safeOutput, body: "Q16과 R17을 비교합니다." }),
    });
    expect(ok.usedLlm).toBe(true);
    expect(fallback.usedLlm).toBe(false);
  });

  it("keeps fallback deterministic from normalized plan", async () => {
    const result = await runLlmCommentaryOrchestratorV1({
      plan: { ...basePlan, referenceLine: { playedMove: "d4", recommendedMove: "q16", pv: ["q16", "bad"] } },
      boardSize: 19,
      llm: () => ({ ...safeOutput, body: "bad output with R17" }),
    });
    expect(result.status).toBe("fallback");
    expect(result.fallbackPlan.referenceLine).toEqual({
      playedMove: "D4",
      recommendedMove: "Q16",
      pv: ["Q16"],
    });
  });
});
