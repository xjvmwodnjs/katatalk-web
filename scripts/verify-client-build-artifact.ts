import path from "node:path";
import { loadEnv } from "vite";
import {
  CLIENT_BUILD_ENV_PREFIXES,
  selectClientBuildEnvironment,
  verifyClientBuildArtifact,
} from "./clientBuildArtifactCore";
import {
  inspectClientBuildGitSource,
  resolveVerifiedClientBuildSourceSha,
} from "./clientBuildSourceProvenance";

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const env = selectClientBuildEnvironment(
    process.env,
    loadEnv("production", repositoryRoot, CLIENT_BUILD_ENV_PREFIXES)
  );
  env.KATATALK_BUILD_COMMIT_SHA = resolveVerifiedClientBuildSourceSha({
    claimedCommitSha: env.KATATALK_BUILD_COMMIT_SHA,
    platformEnv: process.env,
    inspection: inspectClientBuildGitSource(repositoryRoot),
  });
  await verifyClientBuildArtifact({
    outDir: path.resolve(repositoryRoot, "dist", "public"),
    env,
  });
  console.log("[client-build] Clerk client artifact contract verified.");
}

main().catch(error => {
  console.error(
    error instanceof Error ? error.message : "CLIENT_BUILD_CONTRACT_UNKNOWN"
  );
  process.exitCode = 1;
});
