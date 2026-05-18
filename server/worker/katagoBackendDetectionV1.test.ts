import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertKatagoGpuBackendRequirementV1,
  buildKatagoBackendLogLineV1,
  runKatagoBackendCheckCommandV1,
  detectKatagoBackendFromTextV1,
  detectKatagoBackendV1,
  readKatagoBackendCheckModeFrom,
  readKatagoRequireGpuBackendFrom,
} from "./katagoBackendDetectionV1";

const env = {
  KATAGO_BINARY_PATH: "PRIVATE_BINARY_PLACEHOLDER",
  KATAGO_CONFIG_PATH: "PRIVATE_CONFIG_PLACEHOLDER",
  KATAGO_MODEL_PATH: "PRIVATE_MODEL_PLACEHOLDER",
} as NodeJS.ProcessEnv;

describe("katago backend detection v1", () => {
  it("detects CUDA output", () => {
    expect(detectKatagoBackendFromTextV1("KataGo version x\nUsing CUDA backend")).toBe("cuda");
  });

  it("detects OpenCL output", () => {
    expect(detectKatagoBackendFromTextV1("OpenCL backend initialized")).toBe("opencl");
  });

  it("detects TensorRT output", () => {
    expect(detectKatagoBackendFromTextV1("Using TensorRT backend")).toBe("tensorrt");
  });

  it("detects Eigen CPU output", () => {
    expect(detectKatagoBackendFromTextV1("Compiled with Eigen CPU backend")).toBe("eigen");
  });

  it("returns unknown for unknown output", () => {
    expect(detectKatagoBackendFromTextV1("KataGo version x")).toBe("unknown");
  });

  it("returns unknown on command failure", async () => {
    const result = await detectKatagoBackendV1({
      env,
      runner: async () => {
        throw new Error("spawn failed");
      },
    });
    expect(result).toMatchObject({ backend: "unknown", gpuBackend: false, ok: false, timedOut: false });
  });

  it("returns unknown on timeout", async () => {
    const result = await detectKatagoBackendV1({
      env,
      timeoutMs: 100,
      runner: () => new Promise(() => undefined),
    });
    expect(result).toMatchObject({ backend: "unknown", gpuBackend: false, ok: false, timedOut: true });
  });

  it("rejects non-zero OpenCL detection when GPU backend is required", async () => {
    const result = await detectKatagoBackendV1({
      env,
      runner: async () => ({ stdout: "", stderr: "OpenCL initialization failed", code: 1 }),
    });
    expect(result).toMatchObject({ backend: "opencl", gpuBackend: true, ok: false, timedOut: false });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).toThrow(
      /KATAGO_GPU_BACKEND_REQUIRED/
    );
  });

  it("rejects non-zero CUDA detection when GPU backend is required", async () => {
    const result = await detectKatagoBackendV1({
      env,
      runner: async () => ({ stdout: "CUDA backend", stderr: "", code: 1 }),
    });
    expect(result).toMatchObject({ backend: "cuda", gpuBackend: true, ok: false, timedOut: false });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).toThrow(
      /KATAGO_GPU_BACKEND_REQUIRED/
    );
  });

  it("allows zero-code OpenCL detection when GPU backend is required", async () => {
    const result = await detectKatagoBackendV1({
      env,
      runner: async () => ({ stdout: "OpenCL backend", stderr: "", code: 0 }),
    });
    expect(result).toMatchObject({ backend: "opencl", gpuBackend: true, ok: true, timedOut: false });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).not.toThrow();
  });

  it("allows CUDA version_then_smoke when version and smoke both pass", async () => {
    const result = await detectKatagoBackendV1({
      env: {
        ...env,
        KATAGO_REQUIRE_GPU_BACKEND: "true",
        KATAGO_BACKEND_CHECK_MODE: "version_then_smoke",
        KATAGO_BACKEND_CHECK_SMOKE_VISITS: "10",
      },
      runner: async (_binary, args, opts) => {
        if (args[0] === "version") {
          return { stdout: "KataGo CUDA backend", stderr: "", code: 0 };
        }
        expect(args).toEqual(["analysis", "-config", env.KATAGO_CONFIG_PATH, "-model", env.KATAGO_MODEL_PATH]);
        expect(opts?.stdinPayload).toContain("\"analyzeTurns\":[0]");
        expect(opts?.stdinPayload).toContain("\"maxVisits\":10");
        return { stdout: "{\"rootInfo\":{\"winrate\":0.5},\"moveInfos\":[]}\n", stderr: "CUDA initialized", code: 0 };
      },
    });
    expect(result).toMatchObject({
      backend: "cuda",
      gpuBackend: true,
      ok: true,
      versionOk: true,
      smokeOk: true,
      checkMode: "version_then_smoke",
    });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).not.toThrow();
  });

  it("allows OpenCL version_then_smoke when version and smoke both pass", async () => {
    const result = await detectKatagoBackendV1({
      env: { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true", KATAGO_BACKEND_CHECK_MODE: "version_then_smoke" },
      runner: async (_binary, args) =>
        args[0] === "version"
          ? { stdout: "OpenCL backend", stderr: "", code: 0 }
          : { stdout: "{\"rootInfo\":{\"winrate\":0.5}}\n", stderr: "OpenCL device ready", code: 0 },
    });
    expect(result).toMatchObject({ backend: "opencl", gpuBackend: true, ok: true, smokeOk: true });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).not.toThrow();
  });

  it("rejects Eigen version_then_smoke even when smoke response exists", async () => {
    const result = await detectKatagoBackendV1({
      env: { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true", KATAGO_BACKEND_CHECK_MODE: "version_then_smoke" },
      runner: async (_binary, args) =>
        args[0] === "version"
          ? { stdout: "Eigen backend", stderr: "", code: 0 }
          : { stdout: "{\"rootInfo\":{\"winrate\":0.5}}\n", stderr: "Eigen CPU backend", code: 0 },
    });
    expect(result).toMatchObject({ backend: "eigen", gpuBackend: false, ok: true, smokeOk: true });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).toThrow(
      /KATAGO_GPU_BACKEND_REQUIRED/
    );
  });

  it("rejects CUDA detection when analysis smoke fails in require mode", async () => {
    const result = await detectKatagoBackendV1({
      env: { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true", KATAGO_BACKEND_CHECK_MODE: "version_then_smoke" },
      runner: async (_binary, args) =>
        args[0] === "version"
          ? { stdout: "CUDA backend", stderr: "", code: 0 }
          : { stdout: "", stderr: "CUDA initialization failed", code: 1 },
    });
    expect(result).toMatchObject({ backend: "cuda", gpuBackend: true, ok: false, smokeOk: false });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).toThrow(
      /KATAGO_GPU_BACKEND_REQUIRED/
    );
  });

  it("rejects version GPU when smoke explicitly reports Eigen CPU in require mode", async () => {
    const result = await detectKatagoBackendV1({
      env: { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true", KATAGO_BACKEND_CHECK_MODE: "version_then_smoke" },
      runner: async (_binary, args) =>
        args[0] === "version"
          ? { stdout: "CUDA backend", stderr: "", code: 0 }
          : { stdout: "{\"rootInfo\":{\"winrate\":0.5}}\n", stderr: "Eigen backend", code: 0 },
    });
    expect(result).toMatchObject({
      backend: "eigen",
      versionBackend: "cuda",
      smokeBackend: "eigen",
      gpuBackend: false,
      ok: true,
      smokeOk: true,
    });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).toThrow(
      /KATAGO_GPU_BACKEND_REQUIRED/
    );
  });

  it("rejects analysis smoke timeout when GPU backend is required", async () => {
    const result = await detectKatagoBackendV1({
      env: { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true", KATAGO_BACKEND_CHECK_MODE: "analysis_smoke" },
      timeoutMs: 100,
      runner: () => new Promise(() => undefined),
    });
    expect(result).toMatchObject({ backend: "unknown", gpuBackend: false, ok: false, timedOut: true, smokeOk: false });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).toThrow(
      /KATAGO_GPU_BACKEND_REQUIRED/
    );
  });

  it("allows unknown version output when smoke detects GPU backend and passes", async () => {
    const result = await detectKatagoBackendV1({
      env: { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true", KATAGO_BACKEND_CHECK_MODE: "version_then_smoke" },
      runner: async (_binary, args) =>
        args[0] === "version"
          ? { stdout: "KataGo version x", stderr: "", code: 0 }
          : { stdout: "{\"rootInfo\":{\"winrate\":0.5}}\n", stderr: "TensorRT backend initialized", code: 0 },
    });
    expect(result).toMatchObject({ backend: "tensorrt", gpuBackend: true, ok: true, versionOk: true, smokeOk: true });
    expect(() => assertKatagoGpuBackendRequirementV1(result, { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" })).not.toThrow();
  });

  it("rejects Eigen when GPU backend is required", () => {
    expect(() =>
      assertKatagoGpuBackendRequirementV1(
        { backend: "eigen", gpuBackend: false, ok: true, timedOut: false },
        { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" }
      )
    ).toThrow(/KATAGO_GPU_BACKEND_REQUIRED/);
  });

  it("rejects unknown, timeout, and command failure results when GPU backend is required", () => {
    const requireEnv = { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" };
    expect(() =>
      assertKatagoGpuBackendRequirementV1({ backend: "unknown", gpuBackend: false, ok: false, timedOut: false }, requireEnv)
    ).toThrow(/KATAGO_GPU_BACKEND_REQUIRED/);
    expect(() =>
      assertKatagoGpuBackendRequirementV1({ backend: "unknown", gpuBackend: false, ok: false, timedOut: true }, requireEnv)
    ).toThrow(/KATAGO_GPU_BACKEND_REQUIRED/);
  });

  it("allows Eigen as warning-only when GPU backend is not required", () => {
    expect(readKatagoRequireGpuBackendFrom({ ...env, KATAGO_REQUIRE_GPU_BACKEND: "false" })).toBe(false);
    expect(() =>
      assertKatagoGpuBackendRequirementV1(
        { backend: "eigen", gpuBackend: false, ok: true, timedOut: false },
        { ...env, KATAGO_REQUIRE_GPU_BACKEND: "false" }
      )
    ).not.toThrow();
  });

  it("allows non-zero GPU detection and unknown as warning-only when GPU backend is not required", () => {
    const optionalEnv = { ...env, KATAGO_REQUIRE_GPU_BACKEND: "false" };
    expect(() =>
      assertKatagoGpuBackendRequirementV1({ backend: "opencl", gpuBackend: true, ok: false, timedOut: false }, optionalEnv)
    ).not.toThrow();
    expect(() =>
      assertKatagoGpuBackendRequirementV1({ backend: "unknown", gpuBackend: false, ok: false, timedOut: false }, optionalEnv)
    ).not.toThrow();
  });

  it("does not include path or secret values in log line", () => {
    const line = buildKatagoBackendLogLineV1(
      {
        backend: "cuda",
        versionBackend: "cuda",
        smokeBackend: "cuda",
        gpuBackend: true,
        ok: true,
        timedOut: false,
        smokeOk: true,
        checkMode: "version_then_smoke",
      },
      { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true", SECRET_TOKEN: "hidden" }
    );
    expect(line).toContain("katagoBackend=cuda");
    expect(line).toContain("katagoVersionBackend=cuda");
    expect(line).toContain("katagoSmokeBackend=cuda");
    expect(line).toContain("katagoGpuBackend=true");
    expect(line).toContain("katagoBackendCheckMode=version_then_smoke");
    expect(line).toContain("katagoSmokeOk=true");
    expect(line).not.toContain("PRIVATE_BINARY_PLACEHOLDER");
    expect(line).not.toContain("PRIVATE_CONFIG_PLACEHOLDER");
    expect(line).not.toContain("PRIVATE_MODEL_PLACEHOLDER");
    expect(line).not.toContain("hidden");
  });

  it("reads check mode with version default", () => {
    expect(readKatagoBackendCheckModeFrom({})).toBe("version");
    expect(readKatagoBackendCheckModeFrom({ KATAGO_BACKEND_CHECK_MODE: "analysis_smoke" })).toBe("analysis_smoke");
    expect(readKatagoBackendCheckModeFrom({ KATAGO_BACKEND_CHECK_MODE: "version_then_smoke" })).toBe("version_then_smoke");
  });

  it("cleans up a timed-out backend check child process", async () => {
    const started = Date.now();
    await expect(
      runKatagoBackendCheckCommandV1(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 50 })
    ).rejects.toThrow(/KATAGO_BACKEND_CHECK_TIMEOUT/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("config sanity check is warning-only and does not expose config content or path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-config-sanity-"));
    const configPath = path.join(dir, "analysis.cfg");
    await writeFile(
      configPath,
      "numSearchThreadsPerAnalysisThread = 4\nnumAnalysisThreads = 1\ncudaDeviceToUse = 0\nSENSITIVE_CONFIG_MARKER\n",
      "utf8"
    );
    try {
      const result = await detectKatagoBackendV1({
        env: { ...env, KATAGO_CONFIG_PATH: configPath },
        runner: async () => ({ stdout: "CUDA backend", stderr: "", code: 0 }),
      });
      expect(result).toMatchObject({
        configFileExists: true,
        configLooksLikeAnalysis: true,
        configGpuDeviceKeyPresent: true,
      });
      const line = buildKatagoBackendLogLineV1(result, { ...env, KATAGO_CONFIG_PATH: configPath });
      expect(line).toContain("configFileExists=true");
      expect(line).toContain("configLooksLikeAnalysis=true");
      expect(line).toContain("configGpuDeviceKeyPresent=true");
      expect(line).not.toContain(configPath);
      expect(line).not.toContain("SENSITIVE_CONFIG_MARKER");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
