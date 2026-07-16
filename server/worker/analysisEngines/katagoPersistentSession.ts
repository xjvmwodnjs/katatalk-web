import {
  spawn,
  type ChildProcess,
  type StdioOptions,
} from "node:child_process";
import {
  assertKatagoSmokePathsFromEnv,
  buildKatagoAnalysisArgv,
  formatKatagoSmokeCommandPreview,
} from "./katagoCommand";
import {
  KATAGO_WORKER_KILL_GRACE_MS,
  summarizeKatagoStderrForDb,
  type SpawnFn,
} from "./katagoSmokeRun";

type PendingResponse = {
  startedAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
  resolve: (value: PersistentKatagoQueryResult) => void;
  reject: (error: Error) => void;
};

export type PersistentKatagoQueryResult = {
  id: string;
  rawLine: string;
  rawObject: Record<string, unknown>;
  durationMs: number;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export class PersistentKatagoAnalysisSession {
  private proc: ChildProcess | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private pending = new Map<string, PendingResponse>();
  private closed = false;
  private commandPreview = "";

  constructor(
    private readonly opts: {
      env?: NodeJS.ProcessEnv;
      spawnFn?: SpawnFn;
    } = {}
  ) {}

  get preview(): string {
    return this.commandPreview;
  }

  get stderrTail(): string {
    return summarizeKatagoStderrForDb(this.stderrBuffer);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  start(): void {
    if (this.proc && !this.closed) {
      return;
    }
    if (this.closed) {
      this.proc = null;
      this.closed = false;
      this.stdoutBuffer = "";
      this.stderrBuffer = "";
    }
    const env =
      this.opts.env != null
        ? { ...process.env, ...this.opts.env }
        : process.env;
    const paths = assertKatagoSmokePathsFromEnv(env);
    const argv = buildKatagoAnalysisArgv(paths);
    this.commandPreview = `${formatKatagoSmokeCommandPreview(paths.binary, argv)} <persistent-stdin-json>`;
    const spawnFn =
      this.opts.spawnFn ??
      ((cmd, a, o) =>
        spawn(cmd, [...a], { ...o, env: { ...process.env, ...o.env } }));
    const proc = spawnFn(paths.binary, argv, {
      env,
      stdio: ["pipe", "pipe", "pipe"] as StdioOptions,
    });
    this.proc = proc;

    proc.stdout?.on("data", (chunk: Buffer | string) => {
      this.handleStdoutChunk(
        Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk
      );
    });
    proc.stderr?.on("data", (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      this.stderrBuffer = `${this.stderrBuffer}${text}`.slice(-8000);
    });
    proc.on("error", error => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
    });
    proc.on("close", code => {
      this.closed = true;
      this.rejectAll(
        new Error(
          `KATAGO_PERSISTENT_CLOSED: KataGo process closed code=${String(code)}`
        )
      );
    });
  }

  analyzeLine(args: {
    queryLine: string;
    expectedId: string;
    timeoutMs: number;
  }): Promise<PersistentKatagoQueryResult> {
    this.start();
    if (this.closed || !this.proc || !this.proc.stdin) {
      return Promise.reject(
        new Error(
          "KATAGO_PERSISTENT_NOT_AVAILABLE: process stdin is not available."
        )
      );
    }
    if (this.pending.has(args.expectedId)) {
      return Promise.reject(
        new Error(`KATAGO_PERSISTENT_DUPLICATE_ID: ${args.expectedId}`)
      );
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(args.expectedId);
        reject(
          new Error(
            `KATAGO_PERSISTENT_TIMEOUT: id=${args.expectedId} timeoutMs=${String(args.timeoutMs)}`
          )
        );
      }, args.timeoutMs);
      this.pending.set(args.expectedId, {
        startedAt: Date.now(),
        timeoutId,
        resolve,
        reject,
      });

      try {
        this.proc!.stdin!.write(args.queryLine, "utf8", error => {
          if (error) {
            clearTimeout(timeoutId);
            this.pending.delete(args.expectedId);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      } catch (error) {
        clearTimeout(timeoutId);
        this.pending.delete(args.expectedId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async close(): Promise<void> {
    const proc = this.proc;
    if (!proc || this.closed) {
      this.proc = null;
      this.closed = true;
      return;
    }
    await new Promise<void>(resolve => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          finish();
        }, KATAGO_WORKER_KILL_GRACE_MS);
      }, 1000);
      proc.once("close", () => {
        clearTimeout(killTimer);
        finish();
      });
      try {
        proc.stdin?.end();
      } catch {
        clearTimeout(killTimer);
        finish();
      }
    });
    this.proc = null;
    this.closed = true;
  }

  private handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length > 0) {
        this.handleStdoutLine(line);
      }
    }
  }

  private handleStdoutLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isPlainObject(parsed) || typeof parsed.id !== "string") {
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }
    this.pending.delete(parsed.id);
    clearTimeout(pending.timeoutId);
    pending.resolve({
      id: parsed.id,
      rawLine: line,
      rawObject: parsed,
      durationMs: Date.now() - pending.startedAt,
    });
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of Array.from(this.pending.entries())) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`${error.message} pendingId=${id}`));
    }
    this.pending.clear();
  }
}
