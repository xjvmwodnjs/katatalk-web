import { describe, expect, it } from "vitest";
import {
  assertKatagoGpuBackendRequirementV1,
  buildKatagoBackendLogLineV1,
  detectKatagoBackendFromTextV1,
  detectKatagoBackendV1,
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

  it("rejects Eigen when GPU backend is required", () => {
    expect(() =>
      assertKatagoGpuBackendRequirementV1(
        { backend: "eigen", gpuBackend: false, ok: true, timedOut: false },
        { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true" }
      )
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

  it("does not include path or secret values in log line", () => {
    const line = buildKatagoBackendLogLineV1(
      { backend: "cuda", gpuBackend: true, ok: true, timedOut: false },
      { ...env, KATAGO_REQUIRE_GPU_BACKEND: "true", SECRET_TOKEN: "hidden" }
    );
    expect(line).toContain("katagoBackend=cuda");
    expect(line).toContain("katagoGpuBackend=true");
    expect(line).not.toContain("PRIVATE_BINARY_PLACEHOLDER");
    expect(line).not.toContain("PRIVATE_CONFIG_PLACEHOLDER");
    expect(line).not.toContain("PRIVATE_MODEL_PLACEHOLDER");
    expect(line).not.toContain("hidden");
  });
});
