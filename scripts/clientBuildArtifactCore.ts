import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const CLIENT_BUILD_MANIFEST_FILE = "client-build-manifest.json";
export const CLIENT_BUILD_MANIFEST_SCHEMA = "katatalk-client-build-v1";
export const CLIENT_BUILD_MANIFEST_MAX_BYTES = 4 * 1024;
export const CLIENT_BUILD_ENV_PREFIXES = ["VITE_", "KATATALK_BUILD_"];

export type ClerkKeyType = "test" | "live";

export type ClientBuildManifestV1 = {
  schemaVersion: typeof CLIENT_BUILD_MANIFEST_SCHEMA;
  authProvider: "clerk";
  sourceCommitSha: string;
  clerkKeyType: ClerkKeyType;
  clerkPublishableKeySha256: string;
};

export type BuildEnvironment = Record<string, string | undefined>;

export function selectClientBuildEnvironment(
  processEnv: BuildEnvironment,
  fileEnv: BuildEnvironment = {}
): BuildEnvironment {
  return {
    VITE_AUTH_PROVIDER:
      processEnv.VITE_AUTH_PROVIDER ?? fileEnv.VITE_AUTH_PROVIDER,
    VITE_CLERK_PUBLISHABLE_KEY:
      processEnv.VITE_CLERK_PUBLISHABLE_KEY ??
      fileEnv.VITE_CLERK_PUBLISHABLE_KEY,
    KATATALK_BUILD_COMMIT_SHA:
      processEnv.KATATALK_BUILD_COMMIT_SHA ?? fileEnv.KATATALK_BUILD_COMMIT_SHA,
  };
}

function contractError(code: string): Error {
  return new Error(`CLIENT_BUILD_CONTRACT_${code}`);
}

function decodeCanonicalBase64(encoded: string): string | null {
  const unpadded = encoded.replace(/=+$/, "");
  const hasPadding = unpadded.length !== encoded.length;
  if (
    !unpadded ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    unpadded.length % 4 === 1 ||
    (hasPadding && encoded.length % 4 !== 0)
  ) {
    return null;
  }
  try {
    const bytes = Buffer.from(encoded, "base64");
    const canonical = bytes.toString("base64");
    if (
      (hasPadding && canonical !== encoded) ||
      (!hasPadding && canonical.replace(/=+$/, "") !== encoded)
    ) {
      return null;
    }
    const decoded = bytes.toString("utf8");
    const decodedCanonical = Buffer.from(decoded, "utf8").toString("base64");
    if (
      (hasPadding && decodedCanonical !== encoded) ||
      (!hasPadding && decodedCanonical.replace(/=+$/, "") !== encoded)
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/** Mirrors Clerk's public-key envelope without importing an undeclared transitive package. */
export function readClerkPublishableKeyType(key: string): ClerkKeyType | null {
  if (!key || key !== key.trim()) {
    return null;
  }
  const match = /^pk_(test|live)_([A-Za-z0-9+/]+={0,2})$/.exec(key);
  if (!match) {
    return null;
  }
  const decoded = decodeCanonicalBase64(match[2]!);
  if (!decoded || !decoded.endsWith("$")) {
    return null;
  }
  const frontendApi = decoded.slice(0, -1);
  if (
    !frontendApi.includes(".") ||
    frontendApi.includes("$") ||
    frontendApi.includes("..") ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(frontendApi)
  ) {
    return null;
  }
  return match[1] as ClerkKeyType;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeBuildCommitSha(
  value: string | undefined
): string | null {
  if (!value || value !== value.trim() || value !== value.toLowerCase()) {
    return null;
  }
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value) ? value : null;
}

export function createClientBuildManifest(
  env: BuildEnvironment
): ClientBuildManifestV1 {
  if (env.VITE_AUTH_PROVIDER !== "clerk") {
    throw contractError("AUTH_PROVIDER_INVALID");
  }

  const publishableKey = env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
  const clerkKeyType = readClerkPublishableKeyType(publishableKey);
  if (!clerkKeyType) {
    throw contractError("CLERK_PUBLISHABLE_KEY_INVALID");
  }

  const sourceCommitSha = normalizeBuildCommitSha(
    env.KATATALK_BUILD_COMMIT_SHA
  );
  if (!sourceCommitSha) {
    throw contractError("COMMIT_SHA_INVALID");
  }

  return {
    schemaVersion: CLIENT_BUILD_MANIFEST_SCHEMA,
    authProvider: "clerk",
    sourceCommitSha,
    clerkKeyType,
    clerkPublishableKeySha256: sha256Hex(publishableKey),
  };
}

export function serializeClientBuildManifest(
  manifest: ClientBuildManifestV1
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseClientBuildManifest(
  value: unknown
): ClientBuildManifestV1 {
  if (!isPlainObject(value)) {
    throw contractError("MANIFEST_INVALID");
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "authProvider",
    "clerkKeyType",
    "clerkPublishableKeySha256",
    "schemaVersion",
    "sourceCommitSha",
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw contractError("MANIFEST_INVALID");
  }
  if (
    value.schemaVersion !== CLIENT_BUILD_MANIFEST_SCHEMA ||
    value.authProvider !== "clerk" ||
    (value.clerkKeyType !== "test" && value.clerkKeyType !== "live") ||
    typeof value.sourceCommitSha !== "string" ||
    normalizeBuildCommitSha(value.sourceCommitSha) == null ||
    typeof value.clerkPublishableKeySha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.clerkPublishableKeySha256)
  ) {
    throw contractError("MANIFEST_INVALID");
  }
  return value as ClientBuildManifestV1;
}

async function requireRegularFile(
  filePath: string,
  code: string
): Promise<void> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size < 1) {
      throw contractError(code);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("CLIENT_BUILD_CONTRACT_")
    ) {
      throw error;
    }
    throw contractError(code);
  }
}

export async function verifyClientBuildArtifact(options: {
  outDir: string;
  env: BuildEnvironment;
}): Promise<ClientBuildManifestV1> {
  const expected = createClientBuildManifest(options.env);
  const manifestPath = path.join(options.outDir, CLIENT_BUILD_MANIFEST_FILE);
  let manifestText: string;
  try {
    const manifestStat = await stat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.size < 1) {
      throw contractError("MANIFEST_MISSING");
    }
    if (manifestStat.size > CLIENT_BUILD_MANIFEST_MAX_BYTES) {
      throw contractError("MANIFEST_TOO_LARGE");
    }
    manifestText = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("CLIENT_BUILD_CONTRACT_")
    ) {
      throw error;
    }
    throw contractError("MANIFEST_MISSING");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(manifestText) as unknown;
  } catch {
    throw contractError("MANIFEST_INVALID");
  }
  const actual = parseClientBuildManifest(parsedJson);
  if (
    actual.authProvider !== expected.authProvider ||
    actual.sourceCommitSha !== expected.sourceCommitSha ||
    actual.clerkKeyType !== expected.clerkKeyType ||
    actual.clerkPublishableKeySha256 !== expected.clerkPublishableKeySha256
  ) {
    throw contractError("MANIFEST_MISMATCH");
  }
  const publishableKey = options.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
  if (publishableKey && manifestText.includes(publishableKey)) {
    throw contractError("MANIFEST_CONTAINS_RAW_KEY");
  }

  const indexPath = path.join(options.outDir, "index.html");
  await requireRegularFile(indexPath, "INDEX_MISSING");
  let indexHtml: string;
  try {
    indexHtml = await readFile(indexPath, "utf8");
  } catch {
    throw contractError("INDEX_MISSING");
  }
  const assetReferences = Array.from(
    indexHtml.matchAll(/(?:src|href)=["']\/assets\/([^"']+)["']/g),
    match => match[1]!
  );
  if (assetReferences.length < 1) {
    throw contractError("INDEX_ASSETS_MISSING");
  }
  for (const reference of assetReferences) {
    if (
      reference.includes("/") ||
      reference.includes("\\") ||
      reference.includes("..")
    ) {
      throw contractError("INDEX_ASSETS_INVALID");
    }
    await requireRegularFile(
      path.join(options.outDir, "assets", reference),
      "INDEX_ASSETS_MISSING"
    );
  }

  let assetNames: string[];
  try {
    assetNames = await readdir(path.join(options.outDir, "assets"));
  } catch {
    throw contractError("INDEX_ASSETS_MISSING");
  }
  const clerkChunk = assetNames.find(name =>
    /^vendor-clerk-[A-Za-z0-9_-]+\.js$/.test(name)
  );
  if (!clerkChunk) {
    throw contractError("CLERK_CHUNK_MISSING");
  }
  await requireRegularFile(
    path.join(options.outDir, "assets", clerkChunk),
    "CLERK_CHUNK_MISSING"
  );

  return actual;
}
