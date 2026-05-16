import type { ExplanationPlanV1 } from "@shared/explanationPlannerV1";
import type { LlmCommentaryFunctionV1 } from "@shared/llmCommentaryOrchestratorV1";
import { validateAndNormalizeExplanationPlanForLlmV1 } from "@shared/llmCommentaryGuardV1";

export const LLM_COMMENTARY_PROVIDER_V1_VERSION = "llm-commentary-provider-v1" as const;

export const LLM_COMMENTARY_PROVIDER_ENV_V1 = {
  enabled: "KATALK_LLM_COMMENTARY_ENABLED",
  apiKey: "KATALK_LLM_COMMENTARY_API_KEY",
  endpoint: "KATALK_LLM_COMMENTARY_ENDPOINT",
  model: "KATALK_LLM_COMMENTARY_MODEL",
} as const;

export type LlmCommentaryProviderEnvV1 = Partial<Record<string, string | undefined>>;

export type LlmCommentaryProviderClientV1 = {
  complete(input: {
    endpoint: string;
    apiKey: string;
    model: string;
    prompt: string;
    timeoutMs: number;
  }): Promise<string>;
};

export type CreateLlmCommentaryProviderV1Options = {
  env?: LlmCommentaryProviderEnvV1;
  client?: LlmCommentaryProviderClientV1;
  timeoutMs?: number;
  maxOutputChars?: number;
};

export type LlmCommentaryProviderV1 = {
  version: typeof LLM_COMMENTARY_PROVIDER_V1_VERSION;
  enabled: boolean;
  disabledReason: "missing_env" | null;
  llm: LlmCommentaryFunctionV1 | null;
};

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_CHARS = 2_000;

function readEnv(env: LlmCommentaryProviderEnvV1, key: string): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isEnabled(env: LlmCommentaryProviderEnvV1): boolean {
  return readEnv(env, LLM_COMMENTARY_PROVIDER_ENV_V1.enabled)?.toLowerCase() === "true";
}

function timeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("LLM_COMMENTARY_PROVIDER_TIMEOUT")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer != null) {
      clearTimeout(timer);
    }
  });
}

function safePlanForPrompt(plan: ExplanationPlanV1, boardSize: number): Record<string, unknown> {
  return {
    version: plan.version,
    targetType: plan.targetType,
    turnIndex: plan.turnIndex,
    player: plan.player,
    severity: plan.severity,
    confidence: plan.confidence,
    evidenceBullets: plan.evidenceBullets.map((b) => ({
      type: b.type,
      labelKey: b.labelKey,
      value: b.value,
      unit: b.unit,
      textKey: b.textKey,
    })),
    referenceLine: plan.referenceLine,
    caveats: plan.caveats,
    boardSize,
  };
}

export function buildLlmCommentaryPromptV1(plan: ExplanationPlanV1, boardSize: number): string {
  const inputGuard = validateAndNormalizeExplanationPlanForLlmV1(plan);
  if (!inputGuard.ok) {
    throw new Error("LLM_COMMENTARY_PROVIDER_INPUT_REJECTED");
  }

  return [
    "You write short Korean Baduk commentary from the provided safe structured plan only.",
    "Return JSON only with fields: version, title, body, bullets, caveat.",
    "Do not use these labels: 패착 확정, 완착 확정, 악수, 정답, best move, blunder.",
    "Do not invent coordinates, score values, winrate values, percentages, PV moves, or conclusions not present in the plan.",
    "Do not include raw SGF, secrets, environment values, file paths, or logs.",
    "Treat timeline_context, ADI, deep_search, and learning_event as context, not loss proof.",
    JSON.stringify(safePlanForPrompt(inputGuard.plan, boardSize)),
  ].join("\n");
}

function parseProviderJsonResponse(raw: string, maxOutputChars: number): unknown {
  if (raw.length > maxOutputChars) {
    throw new Error("LLM_COMMENTARY_PROVIDER_OUTPUT_TOO_LONG");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("LLM_COMMENTARY_PROVIDER_MALFORMED_RESPONSE");
  }
}

const fetchClient: LlmCommentaryProviderClientV1 = {
  async complete(input) {
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: input.prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      throw new Error("LLM_COMMENTARY_PROVIDER_HTTP_ERROR");
    }
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("LLM_COMMENTARY_PROVIDER_MALFORMED_RESPONSE");
    }
    return content;
  },
};

export function createLlmCommentaryProviderV1(
  options: CreateLlmCommentaryProviderV1Options = {}
): LlmCommentaryProviderV1 {
  const env = options.env ?? process.env;
  const apiKey = readEnv(env, LLM_COMMENTARY_PROVIDER_ENV_V1.apiKey);
  if (!isEnabled(env) || apiKey == null) {
    return {
      version: LLM_COMMENTARY_PROVIDER_V1_VERSION,
      enabled: false,
      disabledReason: "missing_env",
      llm: null,
    };
  }

  const endpoint = readEnv(env, LLM_COMMENTARY_PROVIDER_ENV_V1.endpoint) ?? DEFAULT_ENDPOINT;
  const model = readEnv(env, LLM_COMMENTARY_PROVIDER_ENV_V1.model) ?? DEFAULT_MODEL;
  const client = options.client ?? fetchClient;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  return {
    version: LLM_COMMENTARY_PROVIDER_V1_VERSION,
    enabled: true,
    disabledReason: null,
    llm: async ({ plan, boardSize }) => {
      const prompt = buildLlmCommentaryPromptV1(plan, boardSize);
      const raw = await timeout(
        client.complete({ endpoint, apiKey, model, prompt, timeoutMs }),
        timeoutMs
      );
      return parseProviderJsonResponse(raw, maxOutputChars);
    },
  };
}
