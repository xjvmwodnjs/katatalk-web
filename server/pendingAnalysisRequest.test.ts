import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingAnalysisRequest,
  getOrCreatePendingAnalysisRequest,
  MAX_PENDING_ANALYSIS_RECOVERY_FILE_BYTES,
  PendingAnalysisRequestFileTooLargeError,
  PendingAnalysisRequestStorageError,
} from "../client/src/lib/pendingAnalysisRequest";
import { normalizeAnalysisRequestId } from "../shared/analysisRequestId";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function fileLike(contents: string): File {
  const bytes = new TextEncoder().encode(contents);
  return {
    arrayBuffer: async () => bytes.buffer.slice(0),
    size: bytes.byteLength,
  } as File;
}

describe("pending analysis request persistence", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    });
  });

  it("reuses one request id for the same content and admitted options", async () => {
    const first = await getOrCreatePendingAnalysisRequest(
      fileLike("(;B[pd])"),
      "ko",
      "clerk:user-a"
    );
    const replay = await getOrCreatePendingAnalysisRequest(
      fileLike("(;B[pd])"),
      "ko",
      "clerk:user-a"
    );
    expect(replay).toEqual(first);
    expect(normalizeAnalysisRequestId(first.requestId)).toBe(first.requestId);
  });

  it("keeps independent pending requests and clears only the committed one", async () => {
    const first = await getOrCreatePendingAnalysisRequest(
      fileLike("(;B[pd])"),
      "ko",
      "clerk:user-a"
    );
    const second = await getOrCreatePendingAnalysisRequest(
      fileLike("(;B[dd])"),
      "en",
      "clerk:user-a"
    );
    expect(second.requestId).not.toBe(first.requestId);

    clearPendingAnalysisRequest(first.requestId, first.contentKey);
    const secondReplay = await getOrCreatePendingAnalysisRequest(
      fileLike("(;B[dd])"),
      "en",
      "clerk:user-a"
    );
    expect(secondReplay).toEqual(second);
    const firstAgain = await getOrCreatePendingAnalysisRequest(
      fileLike("(;B[pd])"),
      "ko",
      "clerk:user-a"
    );
    expect(firstAgain.requestId).not.toBe(first.requestId);
  });

  it("persists no SGF or user identity data", async () => {
    const secret = "PRIVATE_SGF_MARKER";
    await getOrCreatePendingAnalysisRequest(
      fileLike(`(;C[${secret}];B[pd])`),
      "ja",
      "clerk:user-private@example.com"
    );
    const serialized = Array.from({ length: storage.length }, (_, index) =>
      storage.getItem(storage.key(index) ?? "")
    ).join("");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("(;C[");
    expect(serialized).not.toContain("clerk:user-private@example.com");
    expect(serialized).toMatch(/[0-9a-f]{64}/);
  });

  it("isolates the same SGF and language across account scopes", async () => {
    const first = await getOrCreatePendingAnalysisRequest(
      fileLike("(;B[pd])"),
      "ko",
      "clerk:user-a"
    );
    const second = await getOrCreatePendingAnalysisRequest(
      fileLike("(;B[pd])"),
      "ko",
      "clerk:user-b"
    );

    expect(second.requestId).not.toBe(first.requestId);
    expect(second.contentKey).not.toBe(first.contentKey);
  });

  it("fails closed before submission when durable storage cannot be written", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => null,
          setItem: () => {
            throw new DOMException("blocked", "QuotaExceededError");
          },
          removeItem: () => undefined,
        },
      },
    });

    await expect(
      getOrCreatePendingAnalysisRequest(
        fileLike("(;B[pd])"),
        "ko",
        "clerk:user-a"
      )
    ).rejects.toBeInstanceOf(PendingAnalysisRequestStorageError);
  });

  it("rejects above the historical recovery ceiling before reading file bytes", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const file = {
      size: MAX_PENDING_ANALYSIS_RECOVERY_FILE_BYTES + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(
      getOrCreatePendingAnalysisRequest(file, "ko", "clerk:user-a")
    ).rejects.toBeInstanceOf(PendingAnalysisRequestFileTooLargeError);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
