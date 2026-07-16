export type SecretScanFinding = {
  line: number;
  rule: string;
};

type SecretRule = {
  name: string;
  pattern: RegExp;
};

const SECRET_RULES: readonly SecretRule[] = [
  {
    name: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "openai_or_live_api_key",
    pattern: /\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "github_token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    name: "slack_token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    name: "aws_access_key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    name: "payment_webhook_secret",
    pattern: /\b(?:whsec|sk_live|rk_live)_[A-Za-z0-9]{16,}\b/,
  },
  {
    name: "jwt",
    pattern:
      /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
];

export function scanTextForCommittedSecrets(text: string): SecretScanFinding[] {
  const findings: SecretScanFinding[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    for (const rule of SECRET_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ line: index + 1, rule: rule.name });
      }
    }
  }

  return findings;
}
