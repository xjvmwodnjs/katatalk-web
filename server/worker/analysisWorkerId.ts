import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

let cachedWorkerId: string | null = null;

/** Vitest 등에서 프로세스 단위 캐시를 비울 때 사용 */
export function resetAnalysisWorkerIdCacheForTests(): void {
  cachedWorkerId = null;
}

/**
 * `ANALYSIS_WORKER_ID` 가 있으면 그대로 사용하고, 없으면 hostname·pid·짧은 난수로 고정 id 를 만든다.
 * 한 프로세스 내에서는 동일 값을 재사용한다.
 */
export function getResolvedAnalysisWorkerId(): string {
  if (cachedWorkerId) {
    return cachedWorkerId;
  }
  const fromEnv = process.env.ANALYSIS_WORKER_ID?.trim();
  if (fromEnv) {
    cachedWorkerId = fromEnv;
    return cachedWorkerId;
  }
  const suffix = randomBytes(4).toString("hex");
  cachedWorkerId = `worker-${hostname()}-${process.pid}-${suffix}`;
  return cachedWorkerId;
}
