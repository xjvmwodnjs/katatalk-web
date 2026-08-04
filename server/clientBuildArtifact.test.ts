import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyClientBuildManifestHeaders } from "./_core/clientBuildStaticHeaders";
import {
  CLIENT_BUILD_MANIFEST_FILE,
  createClientBuildManifest,
  parseClientBuildManifest,
  readClerkPublishableKeyType,
  selectClientBuildEnvironment,
  serializeClientBuildManifest,
  verifyClientBuildArtifact,
} from "../scripts/clientBuildArtifactCore";
import { resolveVerifiedClientBuildSourceSha } from "../scripts/clientBuildSourceProvenance";

const TEST_KEY = "pk_test_Y2kuY2xlcmsuaW52YWxpZCQ";
const COMMIT_SHA = "a".repeat(40);
const BUILD_ENV = {
  VITE_AUTH_PROVIDER: "clerk",
  VITE_CLERK_PUBLISHABLE_KEY: TEST_KEY,
  KATATALK_BUILD_COMMIT_SHA: COMMIT_SHA,
};

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

function publishableKey(
  frontendApi: string,
  type: "test" | "live" = "test"
): string {
  const encoded = Buffer.from(`${frontendApi}$`, "utf8")
    .toString("base64")
    .replace(/=+$/, "");
  return `pk_${type}_${encoded}`;
}

async function writeValidArtifact(): Promise<string> {
  const outDir = await mkdtemp(
    path.join(tmpdir(), "katatalk-client-artifact-")
  );
  tempRoots.push(outDir);
  const assetsDir = path.join(outDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const manifest = createClientBuildManifest(BUILD_ENV);
  await Promise.all([
    writeFile(
      path.join(outDir, CLIENT_BUILD_MANIFEST_FILE),
      serializeClientBuildManifest(manifest)
    ),
    writeFile(
      path.join(outDir, "index.html"),
      '<!doctype html><script type="module" src="/assets/index-build.js"></script>'
    ),
    writeFile(
      path.join(assetsDir, "index-build.js"),
      "import './vendor-clerk-build.js';"
    ),
    writeFile(
      path.join(assetsDir, "vendor-clerk-build.js"),
      "export const clerk = true;"
    ),
  ]);
  return outDir;
}

describe("production Clerk client build contract", () => {
  it("accepts Clerk-compatible test and live publishable-key envelopes", () => {
    expect(readClerkPublishableKeyType(TEST_KEY)).toBe("test");
    expect(readClerkPublishableKeyType(`${TEST_KEY}=`)).toBe("test");
    expect(
      readClerkPublishableKeyType(publishableKey("clerk.example.com", "live"))
    ).toBe("live");
  });

  it.each([
    "",
    "<placeholder>",
    "sk_test_Y2kuY2xlcmsuaW52YWxpZCQ",
    "pk_test_not-base64!",
    `${TEST_KEY}==`,
    ` ${TEST_KEY}`,
    publishableKey("localhost"),
    publishableKey("bad..host"),
    `pk_test_${Buffer.from("bad$host$", "utf8").toString("base64").replace(/=+$/, "")}`,
  ])(
    "rejects a malformed or unsafe Clerk publishable key without reflecting it",
    key => {
      expect(readClerkPublishableKeyType(key)).toBeNull();
      let message = "";
      try {
        createClientBuildManifest({
          ...BUILD_ENV,
          VITE_CLERK_PUBLISHABLE_KEY: key,
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe(
        "CLIENT_BUILD_CONTRACT_CLERK_PUBLISHABLE_KEY_INVALID"
      );
      if (key) expect(message).not.toContain(key);
    }
  );

  it("fails closed for a non-Clerk provider or invalid source commit", () => {
    expect(() =>
      createClientBuildManifest({
        ...BUILD_ENV,
        VITE_AUTH_PROVIDER: "local-dev",
      })
    ).toThrow("CLIENT_BUILD_CONTRACT_AUTH_PROVIDER_INVALID");
    expect(() =>
      createClientBuildManifest({
        ...BUILD_ENV,
        KATATALK_BUILD_COMMIT_SHA: "HEAD",
      })
    ).toThrow("CLIENT_BUILD_CONTRACT_COMMIT_SHA_INVALID");
    expect(() =>
      createClientBuildManifest({
        ...BUILD_ENV,
        KATATALK_BUILD_COMMIT_SHA: COMMIT_SHA.toUpperCase(),
      })
    ).toThrow("CLIENT_BUILD_CONTRACT_COMMIT_SHA_INVALID");
  });

  it("uses the same process-over-file environment precedence as Vite", () => {
    expect(
      selectClientBuildEnvironment(
        { VITE_AUTH_PROVIDER: "clerk" },
        {
          VITE_AUTH_PROVIDER: "local-dev",
          VITE_CLERK_PUBLISHABLE_KEY: TEST_KEY,
          KATATALK_BUILD_COMMIT_SHA: COMMIT_SHA,
        }
      )
    ).toEqual(BUILD_ENV);
  });

  it("emits only the strict non-secret manifest schema", () => {
    const manifest = createClientBuildManifest(BUILD_ENV);
    const serialized = serializeClientBuildManifest(manifest);

    expect(manifest).toMatchObject({
      schemaVersion: "katatalk-client-build-v1",
      authProvider: "clerk",
      sourceCommitSha: COMMIT_SHA,
      clerkKeyType: "test",
    });
    expect(manifest.clerkPublishableKeySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(serialized).not.toContain(TEST_KEY);
    expect(parseClientBuildManifest(JSON.parse(serialized))).toEqual(manifest);
    expect(() =>
      parseClientBuildManifest({ ...manifest, unexpected: true })
    ).toThrow("CLIENT_BUILD_CONTRACT_MANIFEST_INVALID");
  });
});

describe("client build source provenance", () => {
  it("accepts a clean Git checkout and binds an optional claim", () => {
    expect(
      resolveVerifiedClientBuildSourceSha({
        claimedCommitSha: COMMIT_SHA,
        platformEnv: {},
        inspection: { gitCommitSha: COMMIT_SHA, gitIsClean: true },
      })
    ).toBe(COMMIT_SHA);
  });

  it("accepts matching immutable platform evidence without Git metadata", () => {
    expect(
      resolveVerifiedClientBuildSourceSha({
        platformEnv: { RAILWAY_GIT_COMMIT_SHA: COMMIT_SHA },
        inspection: { gitCommitSha: null, gitIsClean: null },
      })
    ).toBe(COMMIT_SHA);
  });

  it.each([
    {
      claimedCommitSha: "b".repeat(40),
      platformEnv: {},
      inspection: { gitCommitSha: COMMIT_SHA, gitIsClean: true },
      code: "SOURCE_MISMATCH",
    },
    {
      claimedCommitSha: COMMIT_SHA,
      platformEnv: {},
      inspection: { gitCommitSha: COMMIT_SHA, gitIsClean: false },
      code: "GIT_DIRTY",
    },
    {
      claimedCommitSha: COMMIT_SHA,
      platformEnv: {},
      inspection: { gitCommitSha: null, gitIsClean: null },
      code: "SOURCE_UNVERIFIED",
    },
  ])("rejects unverified or mismatched source with fixed errors", input => {
    expect(() => resolveVerifiedClientBuildSourceSha(input)).toThrow(
      `CLIENT_BUILD_PROVENANCE_${input.code}`
    );
  });
});

describe("built Clerk artifact verifier", () => {
  it("binds the manifest, index assets, and Clerk chunk to the build environment", async () => {
    const outDir = await writeValidArtifact();
    await expect(
      verifyClientBuildArtifact({ outDir, env: BUILD_ENV })
    ).resolves.toMatchObject({
      authProvider: "clerk",
      sourceCommitSha: COMMIT_SHA,
    });
  });

  it("rejects a stale manifest without exposing the publishable key", async () => {
    const outDir = await writeValidArtifact();
    const manifestPath = path.join(outDir, CLIENT_BUILD_MANIFEST_FILE);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.sourceCommitSha = "b".repeat(40);
    await writeFile(manifestPath, JSON.stringify(manifest));

    let message = "";
    try {
      await verifyClientBuildArtifact({ outDir, env: BUILD_ENV });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("CLIENT_BUILD_CONTRACT_MANIFEST_MISMATCH");
    expect(message).not.toContain(TEST_KEY);
  });

  it("rejects missing Clerk code even when the manifest is valid", async () => {
    const outDir = await writeValidArtifact();
    await rm(path.join(outDir, "assets", "vendor-clerk-build.js"));
    await expect(
      verifyClientBuildArtifact({ outDir, env: BUILD_ENV })
    ).rejects.toThrow("CLIENT_BUILD_CONTRACT_CLERK_CHUNK_MISSING");
  });
});

describe("client build manifest static response", () => {
  it("is served as non-cacheable JSON with sniffing disabled", () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
    };

    expect(
      applyClientBuildManifestHeaders(
        response,
        `dist/public/${CLIENT_BUILD_MANIFEST_FILE}`
      )
    ).toBe(true);
    expect(headers).toEqual(
      new Map([
        ["cache-control", "no-store"],
        ["content-type", "application/json; charset=utf-8"],
        ["x-content-type-options", "nosniff"],
      ])
    );
    expect(
      applyClientBuildManifestHeaders(response, "dist/public/index.html")
    ).toBe(false);
  });
});

describe("CI production client artifact contract", () => {
  it("overrides local-dev only for the mandatory production Clerk build", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8"
    );
    const packageJson = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8"
    );

    expect(workflow).toContain(
      "name: Production Clerk build and artifact verification"
    );
    expect(workflow).toContain("VITE_AUTH_PROVIDER: clerk");
    expect(workflow).toContain("KATATALK_BUILD_COMMIT_SHA: ${{ github.sha }}");
    expect(workflow).toContain(TEST_KEY);
    expect(packageJson).toContain(
      "tsx scripts/verify-client-build-artifact.ts"
    );
  });
});
