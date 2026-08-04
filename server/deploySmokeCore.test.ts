import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkClientBuildManifest,
  checkHealthz,
  checkReadyz,
  normalizeSmokeOrigin,
  requestJson,
  resolveSmokeTarget,
  runDeploySmoke,
} from "../scripts/deploySmokeCore";

const CLIENT_COMMIT_SHA = "c".repeat(40);
const CLERK_KEY_SHA256 = "d".repeat(64);

function clientManifestFetch(
  overrides: Record<string, unknown> = {},
  responseHeaders: Record<string, string> = {}
): typeof fetch {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          schemaVersion: "katatalk-client-build-v1",
          authProvider: "clerk",
          sourceCommitSha: CLIENT_COMMIT_SHA,
          clerkKeyType: "test",
          clerkPublishableKeySha256: CLERK_KEY_SHA256,
          ...overrides,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            ...responseHeaders,
          },
        }
      )
  ) as unknown as typeof fetch;
}

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
        })
    )
  );
});

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
  ) as unknown as typeof fetch;
}

async function listen(server: Server): Promise<string> {
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP test server address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("deploy smoke target trust boundary", () => {
  it("accepts an HTTPS origin and canonicalizes its trailing slash", () => {
    expect(normalizeSmokeOrigin(" https://staging.example.com/ ")).toBe(
      "https://staging.example.com"
    );
  });

  it("allows HTTP only for an explicitly enabled literal loopback origin", () => {
    expect(
      normalizeSmokeOrigin("http://127.0.0.1:4173", {
        allowInsecureLoopback: true,
      })
    ).toBe("http://127.0.0.1:4173");
    expect(() =>
      normalizeSmokeOrigin("http://staging.example.com", {
        allowInsecureLoopback: true,
      })
    ).toThrow(/HTTPS/);
    expect(() =>
      normalizeSmokeOrigin("http://0.0.0.0:4173", {
        allowInsecureLoopback: true,
      })
    ).toThrow(/HTTPS/);
    expect(() =>
      normalizeSmokeOrigin("http://192.168.1.2:4173", {
        allowInsecureLoopback: true,
      })
    ).toThrow(/HTTPS/);
  });

  it.each([
    "https://user:password@staging.example.com",
    "https://staging.example.com/application",
    "https://staging.example.com/?target=other",
    "https://staging.example.com/#fragment",
    "ftp://staging.example.com",
  ])("rejects a non-origin target: %s", target => {
    expect(() => normalizeSmokeOrigin(target)).toThrow();
  });

  it("requires an exact pinned origin before sending credentials", () => {
    expect(() =>
      resolveSmokeTarget({
        baseUrl: "https://staging.example.com",
        authToken: "secret-token",
      })
    ).toThrow(/SMOKE_EXPECTED_ORIGIN/);

    expect(() =>
      resolveSmokeTarget({
        baseUrl: "https://staging.example.com.attacker.invalid",
        expectedOrigin: "https://staging.example.com",
        authToken: "secret-token",
      })
    ).toThrow(/pinned expected origin/);

    expect(
      resolveSmokeTarget({
        baseUrl: "https://staging.example.com/",
        expectedOrigin: "https://staging.example.com",
        authToken: "secret-token",
        opsToken: "ops-secret",
      })
    ).toBe("https://staging.example.com");
  });

  it("never sends credentials to an insecure loopback target", () => {
    expect(() =>
      resolveSmokeTarget({
        baseUrl: "http://127.0.0.1:4173",
        expectedOrigin: "http://127.0.0.1:4173",
        authToken: "secret-token",
        allowInsecureLoopback: true,
      })
    ).toThrow(/HTTPS/);
  });
});

describe("deploy smoke health contracts", () => {
  it("matches the live and readiness endpoint response contracts", async () => {
    await expect(
      checkHealthz(
        "https://staging.example.com",
        1_000,
        jsonFetch({ ok: true, status: "ok" })
      )
    ).resolves.toMatchObject({ status: "pass" });
    await expect(
      checkReadyz(
        "https://staging.example.com",
        1_000,
        jsonFetch({
          ok: true,
          status: "ready",
          checks: [{ name: "database", status: "pass" }],
        })
      )
    ).resolves.toMatchObject({ status: "pass", detail: "ready checks=1" });
  });

  it("fails closed when the health statuses are swapped", async () => {
    await expect(
      checkHealthz(
        "https://staging.example.com",
        1_000,
        jsonFetch({ ok: true, status: "ready" })
      )
    ).resolves.toMatchObject({ status: "fail" });
    await expect(
      checkReadyz(
        "https://staging.example.com",
        1_000,
        jsonFetch({ ok: true, status: "ok", checks: [] })
      )
    ).resolves.toMatchObject({ status: "fail" });
  });

  it("fails without exposing a malformed or server-error response body", async () => {
    const bodySecret = "response-key-must-not-be-logged";
    const result = await checkHealthz(
      "https://staging.example.com",
      1_000,
      jsonFetch({ [bodySecret]: true }, 503)
    );

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("503");
    expect(result.detail).not.toContain(bodySecret);
  });

  it("does not expose readiness check names from the response", async () => {
    const checkNameSecret = "private-readiness-check-name";
    const result = await checkReadyz(
      "https://staging.example.com",
      1_000,
      jsonFetch({
        ok: false,
        status: "not-ready",
        checks: [{ name: checkNameSecret, status: "fail" }],
      })
    );

    expect(result).toMatchObject({
      status: "fail",
      detail: "readiness checks failed (1)",
    });
    expect(result.detail).not.toContain(checkNameSecret);
  });

  it("rejects an oversized response declared by Content-Length", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn(async (_input, init) => {
      requestSignal = init?.signal;
      return new Response(null, {
        status: 200,
        headers: { "Content-Length": String(64 * 1024 + 1) },
      });
    }) as unknown as typeof fetch;

    await expect(
      checkHealthz("https://staging.example.com", 1_000, fetchImpl)
    ).rejects.toThrow("Smoke response body exceeded the safe size limit.");
    expect(requestSignal?.aborted).toBe(true);
  });

  it("rejects an oversized streamed response without Content-Length", async () => {
    const oversizedBody = new Uint8Array(64 * 1024 + 1);
    await expect(
      checkHealthz(
        "https://staging.example.com",
        1_000,
        vi.fn(
          async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(oversizedBody.subarray(0, 32 * 1024));
                  controller.enqueue(oversizedBody.subarray(32 * 1024));
                  controller.close();
                },
              }),
              { status: 200 }
            )
        ) as unknown as typeof fetch
      )
    ).rejects.toThrow("Smoke response body exceeded the safe size limit.");
  });
});

describe("deploy smoke Clerk client artifact preflight", () => {
  it("accepts an exact non-cacheable Clerk manifest", async () => {
    await expect(
      checkClientBuildManifest(
        "https://staging.example.com",
        1_000,
        CLIENT_COMMIT_SHA,
        CLERK_KEY_SHA256,
        clientManifestFetch()
      )
    ).resolves.toMatchObject({
      status: "pass",
      detail: "Clerk client artifact matches the deployment contract",
    });
  });

  it("rejects stale commit and key fingerprints without reflecting either value", async () => {
    const staleCommit = "e".repeat(40);
    const staleKeyHash = "f".repeat(64);
    const commitResult = await checkClientBuildManifest(
      "https://staging.example.com",
      1_000,
      CLIENT_COMMIT_SHA,
      CLERK_KEY_SHA256,
      clientManifestFetch({ sourceCommitSha: staleCommit })
    );
    const keyResult = await checkClientBuildManifest(
      "https://staging.example.com",
      1_000,
      CLIENT_COMMIT_SHA,
      CLERK_KEY_SHA256,
      clientManifestFetch({ clerkPublishableKeySha256: staleKeyHash })
    );

    expect(commitResult).toMatchObject({
      status: "fail",
      detail: "client build commit mismatch",
    });
    expect(keyResult).toMatchObject({
      status: "fail",
      detail: "client build Clerk key fingerprint mismatch",
    });
    expect(JSON.stringify([commitResult, keyResult])).not.toContain(
      staleCommit
    );
    expect(JSON.stringify([commitResult, keyResult])).not.toContain(
      staleKeyHash
    );
  });

  it("rejects a JSON-like MIME type that is not application/json", async () => {
    await expect(
      checkClientBuildManifest(
        "https://staging.example.com",
        1_000,
        CLIENT_COMMIT_SHA,
        CLERK_KEY_SHA256,
        clientManifestFetch({}, { "Content-Type": "application/jsonp" })
      )
    ).resolves.toMatchObject({
      status: "fail",
      detail: "client build manifest response contract mismatch",
    });
  });

  it("sends no auth or ops credential after a manifest mismatch", async () => {
    const authToken = "auth-token-must-not-leave";
    const opsToken = "ops-token-must-not-leave";
    const fetchImpl = clientManifestFetch({ sourceCommitSha: "e".repeat(40) });

    const result = await runDeploySmoke({
      baseUrl: "https://staging.example.com",
      expectedOrigin: "https://staging.example.com",
      authToken,
      opsToken,
      expectedClientCommitSha: CLIENT_COMMIT_SHA,
      expectedClerkKeySha256: CLERK_KEY_SHA256,
      timeoutMs: 1_000,
      createCheckout: false,
      fetchImpl,
    });

    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ status: "fail" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls;
    expect(JSON.stringify(calls)).not.toContain(authToken);
    expect(JSON.stringify(calls)).not.toContain(opsToken);
  });

  it("requires an artifact expectation before any credentialed smoke", async () => {
    await expect(
      runDeploySmoke({
        baseUrl: "https://staging.example.com",
        expectedOrigin: "https://staging.example.com",
        authToken: "credential",
        timeoutMs: 1_000,
        createCheckout: false,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      })
    ).rejects.toThrow(/SMOKE_EXPECTED_CLIENT_COMMIT_SHA/);
  });
});

describe("deploy smoke redirect handling", () => {
  it("uses manual redirects and never forwards a bearer token to the redirect target", async () => {
    const token = "redirect-test-bearer-secret";
    let redirectedRequests = 0;
    const redirectTarget = await listen(
      createServer((_request, response) => {
        redirectedRequests += 1;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      })
    );
    const source = await listen(
      createServer((_request, response) => {
        response.writeHead(302, {
          Location: `${redirectTarget}/credential-capture`,
        });
        response.end();
      })
    );

    let message = "";
    try {
      await requestJson(source, "/healthz", 1_000, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("Redirect response 302 rejected.");
    expect(message).not.toContain(token);
    expect(message).not.toContain("credential-capture");
    expect(redirectedRequests).toBe(0);
  });

  it("overrides a caller redirect policy with manual handling", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    ) as unknown as typeof fetch;

    await requestJson(
      "https://staging.example.com",
      "/healthz",
      1_000,
      { redirect: "follow" },
      fetchImpl
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://staging.example.com/healthz"),
      expect.objectContaining({ redirect: "manual" })
    );
  });
});

describe("staging smoke workflow contract", () => {
  it("pins the protected environment target instead of accepting an arbitrary URL", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/staging-smoke.yml", import.meta.url),
      "utf8"
    );

    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain("SMOKE_BASE_URL: ${{ vars.STAGING_BASE_URL }}");
    expect(workflow).toContain(
      "SMOKE_EXPECTED_ORIGIN: ${{ vars.STAGING_BASE_URL }}"
    );
    expect(workflow).toContain(
      "SMOKE_EXPECTED_CLIENT_COMMIT_SHA: ${{ github.sha }}"
    );
    expect(workflow).toContain(
      "SMOKE_EXPECTED_CLERK_KEY_SHA256: ${{ vars.STAGING_CLERK_PUBLISHABLE_KEY_SHA256 }}"
    );
    expect(workflow).toContain("corepack pnpm deploy:smoke -- --artifact-only");
    expect(workflow).not.toMatch(/^\s+base_url:/m);
  });

  it("does not expose staging secrets to checkout or dependency installation", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/staging-smoke.yml", import.meta.url),
      "utf8"
    );
    const runStep = workflow.indexOf("- name: Run deploy smoke");

    expect(runStep).toBeGreaterThan(0);
    expect(workflow.slice(0, runStep)).not.toContain(
      "${{ secrets.SMOKE_AUTH_TOKEN }}"
    );
    expect(workflow.slice(0, runStep)).not.toContain(
      "${{ secrets.SMOKE_OPS_TOKEN }}"
    );
    expect(workflow.slice(runStep)).toContain(
      "SMOKE_AUTH_TOKEN: ${{ secrets.SMOKE_AUTH_TOKEN }}"
    );
    expect(workflow.slice(runStep)).toContain(
      "SMOKE_OPS_TOKEN: ${{ secrets.SMOKE_OPS_TOKEN }}"
    );
  });

  it("guards the staging environment with the master ref", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/staging-smoke.yml", import.meta.url),
      "utf8"
    );

    expect(workflow).toContain("if: github.ref == 'refs/heads/master'");
    expect(workflow).toContain(
      'if [ "${GITHUB_REF}" != "refs/heads/master" ]; then'
    );
  });
});
