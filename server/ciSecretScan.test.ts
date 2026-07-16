import { describe, expect, it } from "vitest";
import { scanTextForCommittedSecrets } from "./ciSecretScan";

describe("scanTextForCommittedSecrets", () => {
  it("reports supported secret patterns with line numbers without returning values", () => {
    const openAiKey = ["sk-proj", "abcdefghijklmnopqrstuvwx"].join("_");
    const awsAccessKey = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    const findings = scanTextForCommittedSecrets(
      `safe=true\napi=${openAiKey}\nkey=${awsAccessKey}`
    );

    expect(findings).toEqual([
      { line: 2, rule: "openai_or_live_api_key" },
      { line: 3, rule: "aws_access_key" },
    ]);
    expect(JSON.stringify(findings)).not.toContain(openAiKey);
  });

  it("does not flag placeholders or ordinary documentation", () => {
    expect(
      scanTextForCommittedSecrets(
        "OPENAI_API_KEY=<placeholder>\nKATAGO_CONFIG_PATH=<placeholder>"
      )
    ).toEqual([]);
  });
});
