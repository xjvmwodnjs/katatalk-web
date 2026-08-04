import { execFileSync } from "node:child_process";
import { normalizeBuildCommitSha } from "./clientBuildArtifactCore";

export const CLIENT_BUILD_PLATFORM_SHA_NAMES = [
  "GITHUB_SHA",
  "RAILWAY_GIT_COMMIT_SHA",
  "RENDER_GIT_COMMIT",
] as const;

type SourceEnvironment = Record<string, string | undefined>;

export type ClientBuildSourceInspection = {
  gitCommitSha: string | null;
  gitIsClean: boolean | null;
};

function provenanceError(code: string): Error {
  return new Error(`CLIENT_BUILD_PROVENANCE_${code}`);
}

export function inspectClientBuildGitSource(
  repositoryRoot: string
): ClientBuildSourceInspection {
  let gitCommitSha: string;
  try {
    gitCommitSha = execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${repositoryRoot.replaceAll("\\", "/")}`,
        "rev-parse",
        "--verify",
        "HEAD",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    ).trim();
  } catch {
    return { gitCommitSha: null, gitIsClean: null };
  }

  try {
    const status = execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${repositoryRoot.replaceAll("\\", "/")}`,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    return { gitCommitSha, gitIsClean: status.trim().length === 0 };
  } catch {
    return { gitCommitSha, gitIsClean: null };
  }
}

export function resolveVerifiedClientBuildSourceSha(options: {
  claimedCommitSha?: string | null;
  platformEnv: SourceEnvironment;
  inspection: ClientBuildSourceInspection;
}): string {
  const rawClaim = options.claimedCommitSha ?? "";
  const claimedCommitSha = rawClaim ? normalizeBuildCommitSha(rawClaim) : null;
  if (rawClaim && !claimedCommitSha) {
    throw provenanceError("CLAIM_INVALID");
  }

  const platformShas: string[] = [];
  for (const name of CLIENT_BUILD_PLATFORM_SHA_NAMES) {
    const rawValue = options.platformEnv[name];
    if (rawValue == null || rawValue === "") continue;
    const value = normalizeBuildCommitSha(rawValue);
    if (!value) {
      throw provenanceError("PLATFORM_SHA_INVALID");
    }
    platformShas.push(value);
  }
  if (new Set(platformShas).size > 1) {
    throw provenanceError("SOURCE_MISMATCH");
  }

  let verifiedSourceSha = platformShas[0] ?? null;
  if (options.inspection.gitCommitSha != null) {
    const gitCommitSha = normalizeBuildCommitSha(
      options.inspection.gitCommitSha
    );
    if (!gitCommitSha || options.inspection.gitIsClean == null) {
      throw provenanceError("GIT_INSPECTION_INVALID");
    }
    if (!options.inspection.gitIsClean) {
      throw provenanceError("GIT_DIRTY");
    }
    if (verifiedSourceSha && verifiedSourceSha !== gitCommitSha) {
      throw provenanceError("SOURCE_MISMATCH");
    }
    verifiedSourceSha = gitCommitSha;
  }

  if (!verifiedSourceSha) {
    throw provenanceError("SOURCE_UNVERIFIED");
  }
  if (claimedCommitSha && claimedCommitSha !== verifiedSourceSha) {
    throw provenanceError("SOURCE_MISMATCH");
  }
  return verifiedSourceSha;
}
