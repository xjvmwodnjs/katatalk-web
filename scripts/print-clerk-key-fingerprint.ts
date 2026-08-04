import path from "node:path";
import { loadEnv } from "vite";
import {
  CLIENT_BUILD_ENV_PREFIXES,
  readClerkPublishableKeyType,
  selectClientBuildEnvironment,
  sha256Hex,
} from "./clientBuildArtifactCore";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const env = selectClientBuildEnvironment(
  process.env,
  loadEnv("production", repositoryRoot, CLIENT_BUILD_ENV_PREFIXES)
);
const publishableKey = env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
if (!readClerkPublishableKeyType(publishableKey)) {
  console.error("CLIENT_BUILD_CONTRACT_CLERK_PUBLISHABLE_KEY_INVALID");
  process.exitCode = 1;
} else {
  console.log(sha256Hex(publishableKey));
}
