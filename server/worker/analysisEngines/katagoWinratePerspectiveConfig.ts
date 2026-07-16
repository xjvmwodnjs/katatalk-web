import { readFileSync } from "node:fs";
import type { KatagoConfiguredWinratePerspectiveV1 } from "@shared/winratePerspectiveV1";

export const KATAGO_WINRATE_PERSPECTIVE_EXPECTED_ENV =
  "KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED" as const;

export type KatagoWinratePerspectiveConfigIssue =
  | "CONFIG_PATH_MISSING"
  | "CONFIG_UNREADABLE"
  | "SETTING_MISSING"
  | "SETTING_DUPLICATED"
  | "SETTING_UNSUPPORTED"
  | "EXPECTED_UNSUPPORTED"
  | "EXPECTED_MISMATCH"
  | "EXPECTED_ONLY";

export type KatagoWinratePerspectiveConfigResolution = {
  perspective: KatagoConfiguredWinratePerspectiveV1;
  source: "config" | "expected_only" | "unknown";
  configuredRawValue: string | null;
  expectedRawValue: string | null;
  issue: KatagoWinratePerspectiveConfigIssue | null;
};

function canonicalPerspective(
  value: string | null | undefined
): KatagoConfiguredWinratePerspectiveV1 {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (normalized === "BLACK") {
    return "black";
  }
  if (normalized === "WHITE") {
    return "white";
  }
  if (normalized === "SIDETOMOVE") {
    return "side_to_move";
  }
  return "unknown";
}

export function parseKatagoReportAnalysisWinratesAsConfig(
  configText: string
): Pick<
  KatagoWinratePerspectiveConfigResolution,
  "perspective" | "configuredRawValue" | "issue"
> {
  const values: string[] = [];
  for (const line of configText.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const active = line.split("#", 1)[0]?.trim() ?? "";
    if (!active) {
      continue;
    }
    const match = /^reportAnalysisWinratesAs\s*=\s*(.*?)\s*$/i.exec(active);
    if (match) {
      values.push(match[1]?.trim() ?? "");
    }
  }

  if (values.length === 0) {
    return {
      perspective: "unknown",
      configuredRawValue: null,
      issue: "SETTING_MISSING",
    };
  }
  if (values.length !== 1) {
    return {
      perspective: "unknown",
      configuredRawValue: null,
      issue: "SETTING_DUPLICATED",
    };
  }

  const configuredRawValue = values[0] ?? "";
  const perspective = canonicalPerspective(configuredRawValue);
  return {
    perspective,
    configuredRawValue,
    issue: perspective === "unknown" ? "SETTING_UNSUPPORTED" : null,
  };
}

export function resolveKatagoWinratePerspectiveConfig(
  env: NodeJS.ProcessEnv = process.env
): KatagoWinratePerspectiveConfigResolution {
  const expectedRawValue =
    env[KATAGO_WINRATE_PERSPECTIVE_EXPECTED_ENV]?.trim() || null;
  const expected = canonicalPerspective(expectedRawValue);
  if (expectedRawValue && expected === "unknown") {
    return {
      perspective: "unknown",
      source: "unknown",
      configuredRawValue: null,
      expectedRawValue,
      issue: "EXPECTED_UNSUPPORTED",
    };
  }

  const configPath = env.KATAGO_CONFIG_PATH?.trim();
  if (!configPath) {
    return expected !== "unknown"
      ? {
          perspective: expected,
          source: "expected_only",
          configuredRawValue: null,
          expectedRawValue,
          issue: "EXPECTED_ONLY",
        }
      : {
          perspective: "unknown",
          source: "unknown",
          configuredRawValue: null,
          expectedRawValue,
          issue: "CONFIG_PATH_MISSING",
        };
  }

  let configText: string;
  try {
    configText = readFileSync(configPath, "utf8");
  } catch {
    return expected !== "unknown"
      ? {
          perspective: expected,
          source: "expected_only",
          configuredRawValue: null,
          expectedRawValue,
          issue: "EXPECTED_ONLY",
        }
      : {
          perspective: "unknown",
          source: "unknown",
          configuredRawValue: null,
          expectedRawValue,
          issue: "CONFIG_UNREADABLE",
        };
  }

  const parsed = parseKatagoReportAnalysisWinratesAsConfig(configText);
  if (parsed.perspective === "unknown") {
    return {
      ...parsed,
      source: "unknown",
      expectedRawValue,
    };
  }
  if (expected !== "unknown" && expected !== parsed.perspective) {
    return {
      perspective: "unknown",
      source: "unknown",
      configuredRawValue: parsed.configuredRawValue,
      expectedRawValue,
      issue: "EXPECTED_MISMATCH",
    };
  }
  return {
    perspective: parsed.perspective,
    source: "config",
    configuredRawValue: parsed.configuredRawValue,
    expectedRawValue,
    issue: null,
  };
}

export function assertKatagoWinratePerspectiveConfig(
  env: NodeJS.ProcessEnv = process.env
): Exclude<KatagoConfiguredWinratePerspectiveV1, "unknown"> {
  const resolved = resolveKatagoWinratePerspectiveConfig(env);
  if (resolved.source !== "config" || resolved.perspective === "unknown") {
    throw new Error(
      `KATAGO_WINRATE_PERSPECTIVE_UNVERIFIED: analysis config must contain exactly one supported reportAnalysisWinratesAs value and match ${KATAGO_WINRATE_PERSPECTIVE_EXPECTED_ENV} when set (reason=${resolved.issue ?? "unknown"}).`
    );
  }
  return resolved.perspective;
}
