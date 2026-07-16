import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertKatagoWinratePerspectiveConfig,
  parseKatagoReportAnalysisWinratesAsConfig,
  resolveKatagoWinratePerspectiveConfig,
} from "./worker/analysisEngines/katagoWinratePerspectiveConfig";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function configPath(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "katatalk-winrate-axis-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "analysis.cfg");
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

describe("KataGo reportAnalysisWinratesAs config", () => {
  it.each([
    ["BLACK", "black"],
    ["white", "white"],
    ["SIDETOMOVE", "side_to_move"],
  ] as const)("parses %s as %s", (raw, expected) => {
    expect(
      parseKatagoReportAnalysisWinratesAsConfig(
        `# axis\nreportAnalysisWinratesAs = ${raw} # verified\n`
      )
    ).toEqual({
      perspective: expected,
      configuredRawValue: raw,
      issue: null,
    });
  });

  it("rejects missing, duplicated, and unsupported settings", () => {
    expect(
      parseKatagoReportAnalysisWinratesAsConfig("maxVisits = 10").issue
    ).toBe("SETTING_MISSING");
    expect(
      parseKatagoReportAnalysisWinratesAsConfig(
        "reportAnalysisWinratesAs=BLACK\nreportAnalysisWinratesAs=WHITE"
      ).issue
    ).toBe("SETTING_DUPLICATED");
    expect(
      parseKatagoReportAnalysisWinratesAsConfig(
        "reportAnalysisWinratesAs=SIDE_TO_MOVE"
      ).issue
    ).toBe("SETTING_UNSUPPORTED");
  });

  it("resolves a readable config and rejects an expected-value mismatch", () => {
    const filePath = configPath("reportAnalysisWinratesAs = BLACK\n");
    const matching = resolveKatagoWinratePerspectiveConfig({
      KATAGO_CONFIG_PATH: filePath,
      KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED: "BLACK",
    });
    expect(matching).toMatchObject({
      perspective: "black",
      source: "config",
      issue: null,
    });
    expect(
      assertKatagoWinratePerspectiveConfig({
        KATAGO_CONFIG_PATH: filePath,
        KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED: "BLACK",
      })
    ).toBe("black");

    const mismatch = resolveKatagoWinratePerspectiveConfig({
      KATAGO_CONFIG_PATH: filePath,
      KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED: "WHITE",
    });
    expect(mismatch).toMatchObject({
      perspective: "unknown",
      source: "unknown",
      issue: "EXPECTED_MISMATCH",
    });
    expect(() =>
      assertKatagoWinratePerspectiveConfig({
        KATAGO_CONFIG_PATH: filePath,
        KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED: "WHITE",
      })
    ).toThrow(/KATAGO_WINRATE_PERSPECTIVE_UNVERIFIED/);
  });

  it("allows expected-only resolution for injected tests but not Worker startup", () => {
    const env = {
      KATAGO_CONFIG_PATH: "Z:/missing/analysis.cfg",
      KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED: "BLACK",
    };
    expect(resolveKatagoWinratePerspectiveConfig(env)).toMatchObject({
      perspective: "black",
      source: "expected_only",
      issue: "EXPECTED_ONLY",
    });
    expect(() => assertKatagoWinratePerspectiveConfig(env)).toThrow(
      /EXPECTED_ONLY/
    );
  });
});
