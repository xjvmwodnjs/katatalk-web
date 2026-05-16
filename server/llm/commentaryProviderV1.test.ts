import { describe, expect, it } from "vitest";
import type { ExplanationPlanV1 } from "@shared/explanationPlannerV1";
import { LLM_COMMENTARY_GUARD_V1_VERSION } from "@shared/llmCommentaryGuardV1";
import {
  buildLlmCommentaryPromptV1,
  createLlmCommentaryProviderV1,
  LLM_COMMENTARY_PROVIDER_ENV_V1,
  type LlmCommentaryProviderClientV1,
} from "./commentaryProviderV1";

const safePlan: ExplanationPlanV1 = {
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
  ],
  referenceLine: {
    playedMove: "D4",
    recommendedMove: "Q16",
    pv: ["Q16", "D16"],
  },
  caveats: ["ep_caveat_candidate_not_final_judgement"],
  forbiddenLabelSafe: true,
};

const safeResponse = {
  version: LLM_COMMENTARY_GUARD_V1_VERSION,
  title: "검토 후보",
  body: "D4 이후 Q16 참고 수순을 확인합니다.",
  bullets: ["3.5집 근거를 함께 봅니다."],
  caveat: "후보 신뢰도는 확정 판정이 아닙니다.",
};

function enabledEnv(): Record<string, string> {
  return {
    [LLM_COMMENTARY_PROVIDER_ENV_V1.enabled]: "true",
    [LLM_COMMENTARY_PROVIDER_ENV_V1.apiKey]: "secret-api-key",
    [LLM_COMMENTARY_PROVIDER_ENV_V1.endpoint]: "https://llm.example.test/v1/chat/completions",
    [LLM_COMMENTARY_PROVIDER_ENV_V1.model]: "commentary-test-model",
  };
}

describe("llm commentary provider v1", () => {
  it("is disabled when env is missing", () => {
    const provider = createLlmCommentaryProviderV1({ env: {} });
    expect(provider.enabled).toBe(false);
    expect(provider.disabledReason).toBe("missing_env");
    expect(provider.llm).toBeNull();
  });

  it("does not expose a callable llm when disabled", () => {
    let calls = 0;
    const client: LlmCommentaryProviderClientV1 = {
      async complete() {
        calls += 1;
        return JSON.stringify(safeResponse);
      },
    };
    const provider = createLlmCommentaryProviderV1({ env: {}, client });
    expect(provider.llm).toBeNull();
    expect(calls).toBe(0);
  });

  it("returns fake client safe response", async () => {
    let capturedPrompt = "";
    const client: LlmCommentaryProviderClientV1 = {
      async complete(input) {
        capturedPrompt = input.prompt;
        return JSON.stringify(safeResponse);
      },
    };
    const provider = createLlmCommentaryProviderV1({ env: enabledEnv(), client });
    await expect(provider.llm?.({ plan: safePlan, boardSize: 19 })).resolves.toEqual(safeResponse);
    expect(capturedPrompt).toContain("Return JSON only");
    expect(capturedPrompt).not.toContain("secret-api-key");
  });

  it("throws when fake client throws", async () => {
    const provider = createLlmCommentaryProviderV1({
      env: enabledEnv(),
      client: {
        async complete() {
          throw new Error("fake client failure");
        },
      },
    });
    await expect(provider.llm?.({ plan: safePlan, boardSize: 19 })).rejects.toThrow("fake client failure");
  });

  it("throws on timeout", async () => {
    const provider = createLlmCommentaryProviderV1({
      env: enabledEnv(),
      timeoutMs: 5,
      client: {
        async complete() {
          await new Promise(() => undefined);
          return JSON.stringify(safeResponse);
        },
      },
    });
    await expect(provider.llm?.({ plan: safePlan, boardSize: 19 })).rejects.toThrow("LLM_COMMENTARY_PROVIDER_TIMEOUT");
  });

  it("throws on malformed provider response", async () => {
    const provider = createLlmCommentaryProviderV1({
      env: enabledEnv(),
      client: {
        async complete() {
          return "not-json";
        },
      },
    });
    await expect(provider.llm?.({ plan: safePlan, boardSize: 19 })).rejects.toThrow("LLM_COMMENTARY_PROVIDER_MALFORMED_RESPONSE");
  });

  it("rejects raw SGF-like payload before prompt/client call", async () => {
    let calls = 0;
    const provider = createLlmCommentaryProviderV1({
      env: enabledEnv(),
      client: {
        async complete() {
          calls += 1;
          return JSON.stringify(safeResponse);
        },
      },
    });
    await expect(
      provider.llm?.({
        plan: { ...safePlan, caveats: ["(;GM[1]FF[4]SZ[19];B[dd];W[qq])"] },
        boardSize: 19,
      })
    ).rejects.toThrow("LLM_COMMENTARY_PROVIDER_INPUT_REJECTED");
    expect(calls).toBe(0);
  });

  it("rejects secret/env/path-like payload before prompt/client call", async () => {
    let calls = 0;
    const provider = createLlmCommentaryProviderV1({
      env: enabledEnv(),
      client: {
        async complete() {
          calls += 1;
          return JSON.stringify(safeResponse);
        },
      },
    });
    await expect(
      provider.llm?.({
        plan: { ...safePlan, caveats: ["SUPABASE_SERVICE_ROLE_KEY=C:/Users/example/secret"] },
        boardSize: 19,
      })
    ).rejects.toThrow("LLM_COMMENTARY_PROVIDER_INPUT_REJECTED");
    expect(calls).toBe(0);
  });

  it("includes forbidden-label prohibition in prompt", () => {
    const prompt = buildLlmCommentaryPromptV1(safePlan, 19);
    expect(prompt).toContain("패착 확정");
    expect(prompt).toContain("best move");
    expect(prompt).toContain("Do not invent coordinates");
  });
});
