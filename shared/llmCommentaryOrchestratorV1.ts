import type { ExplanationPlanV1 } from "./explanationPlannerV1";
import type { LlmCommentaryOutputV1 } from "./llmCommentaryGuardV1";
import {
  validateAndNormalizeExplanationPlanForLlmV1,
  validateLlmCommentaryOutputV1,
} from "./llmCommentaryGuardV1";
import {
  isSupportedCommentaryBoardSizeV1,
  sanitizeReferenceLineForBoardSizeV1,
  verifyLlmCommentaryClaimsV1,
} from "./llmCommentaryClaimVerifierV1";

export const LLM_COMMENTARY_ORCHESTRATOR_V1_VERSION = "llm-commentary-orchestrator-v1" as const;

export type LlmCommentaryOrchestrationResultV1 = {
  status: "ok" | "fallback";
  reasonCode: string | null;
  commentary: LlmCommentaryOutputV1 | null;
  fallbackPlan: ExplanationPlanV1;
  usedLlm: boolean;
};

export type LlmCommentaryFunctionInputV1 = {
  plan: ExplanationPlanV1;
  boardSize: number;
};

export type LlmCommentaryFunctionV1 = (
  input: LlmCommentaryFunctionInputV1
) => Promise<unknown> | unknown;

export type RunLlmCommentaryOrchestratorV1Input = {
  plan: ExplanationPlanV1;
  boardSize: number;
  llm: LlmCommentaryFunctionV1;
};

function fallback(
  fallbackPlan: ExplanationPlanV1,
  reasonCode: string
): LlmCommentaryOrchestrationResultV1 {
  return {
    status: "fallback",
    reasonCode,
    commentary: null,
    fallbackPlan,
    usedLlm: false,
  };
}

function firstReason(prefix: string, issues: readonly string[]): string {
  return issues.length > 0 ? `${prefix}_${issues[0]}` : prefix;
}

function safeFallbackTargetType(input: ExplanationPlanV1): ExplanationPlanV1["targetType"] {
  return input.targetType === "decisive_move" ? "decisive_move" : "review_move";
}

function buildMinimalSafeFallbackPlan(input: ExplanationPlanV1): ExplanationPlanV1 {
  return {
    version: "explanation-planner-v1",
    targetType: safeFallbackTargetType(input),
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
  };
}

export async function runLlmCommentaryOrchestratorV1(
  input: RunLlmCommentaryOrchestratorV1Input
): Promise<LlmCommentaryOrchestrationResultV1> {
  const inputGuard = validateAndNormalizeExplanationPlanForLlmV1(input.plan);
  if (!inputGuard.ok) {
    return fallback(buildMinimalSafeFallbackPlan(input.plan), firstReason("input_guard", inputGuard.issues));
  }

  if (!isSupportedCommentaryBoardSizeV1(input.boardSize)) {
    return fallback(inputGuard.plan, "invalid_board_size");
  }

  const normalizedPlan: ExplanationPlanV1 = {
    ...inputGuard.plan,
    referenceLine: sanitizeReferenceLineForBoardSizeV1(inputGuard.plan.referenceLine, input.boardSize),
  };

  let candidateOutput: unknown;
  try {
    candidateOutput = await input.llm({ plan: normalizedPlan, boardSize: input.boardSize });
  } catch {
    return fallback(normalizedPlan, "llm_throw");
  }

  const outputGuard = validateLlmCommentaryOutputV1(candidateOutput);
  if (!outputGuard.ok) {
    return fallback(normalizedPlan, firstReason("output_guard", outputGuard.issues));
  }

  const claimVerifier = verifyLlmCommentaryClaimsV1({
    plan: normalizedPlan,
    boardSize: input.boardSize,
    output: outputGuard.output,
  });
  if (!claimVerifier.ok) {
    return fallback(normalizedPlan, firstReason("claim_verifier", claimVerifier.issues));
  }

  return {
    status: "ok",
    reasonCode: null,
    commentary: outputGuard.output,
    fallbackPlan: normalizedPlan,
    usedLlm: true,
  };
}
