import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { scanTextForCommittedSecrets } from "../server/ciSecretScan";

const MAX_SCANNED_FILE_BYTES = 1_000_000;

function listTrackedFiles(): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    {
      encoding: "utf8",
    }
  );
  return output.split("\0").filter(Boolean);
}

function readTextFile(relativePath: string): string | null {
  try {
    if (statSync(relativePath).size > MAX_SCANNED_FILE_BYTES) {
      return null;
    }
    const content = readFileSync(relativePath);
    return content.includes(0) ? null : content.toString("utf8");
  } catch {
    return null;
  }
}

const findings = listTrackedFiles().flatMap(relativePath => {
  const text = readTextFile(relativePath);
  if (text == null) {
    return [];
  }
  return scanTextForCommittedSecrets(text).map(finding => ({
    ...finding,
    relativePath: path.normalize(relativePath),
  }));
});

if (findings.length > 0) {
  console.error("[ci-secret-scan] potential committed secrets detected:");
  for (const finding of findings) {
    console.error(
      `- ${finding.relativePath}:${finding.line} (${finding.rule})`
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    "[ci-secret-scan] no supported secret patterns found in repository text files."
  );
}
