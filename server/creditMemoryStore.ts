/**
 * 로컬/테스트 전용 메모리 크레딧 저장소.
 * production + DATABASE_URL 없음 조합에서는 서버 기동 시 env 검증으로 차단한다.
 */

import type { CreditLedgerRow } from "../drizzle/schema";

export type MemoryLedgerEntry = Pick<
  CreditLedgerRow,
  "type" | "amount" | "balanceAfter" | "analysisJobId" | "idempotencyKey" | "metadata"
> & { id: number };

type WalletRow = {
  id: number;
  clerkUserId: string;
  userId: number | null;
  balance: number;
  signupBonusGranted: number;
  ledger: MemoryLedgerEntry[];
};

let nextWalletId = 1;
let nextLedgerId = 1;

const walletsByClerk = new Map<string, WalletRow>();

const lockChains = new Map<string, Promise<unknown>>();

function runSerialized<T>(clerkUserId: string, fn: () => Promise<T>): Promise<T> {
  const prev = lockChains.get(clerkUserId) ?? Promise.resolve();
  const next = prev.then(fn, fn) as Promise<T>;
  lockChains.set(clerkUserId, next.finally(() => {
    if (lockChains.get(clerkUserId) === next) {
      lockChains.delete(clerkUserId);
    }
  }));
  return next;
}

export function __resetCreditMemoryStoreForTests() {
  walletsByClerk.clear();
  lockChains.clear();
  nextWalletId = 1;
  nextLedgerId = 1;
}

export async function memoryEnsureWalletWithSignupBonus(
  clerkUserId: string,
  appUserId: number | null
): Promise<{ walletId: number; balance: number }> {
  return runSerialized(clerkUserId, async () => {
    let w = walletsByClerk.get(clerkUserId);
    if (!w) {
      w = {
        id: nextWalletId++,
        clerkUserId,
        userId: appUserId,
        balance: 0,
        signupBonusGranted: 0,
        ledger: [],
      };
      walletsByClerk.set(clerkUserId, w);
    } else if (appUserId != null && w.userId == null) {
      w.userId = appUserId;
    }

    const idem = `signup_bonus:${clerkUserId}`;
    if (w.ledger.some(l => l.idempotencyKey === idem)) {
      return { walletId: w.id, balance: w.balance };
    }

    w.balance += 2;
    w.signupBonusGranted = 1;
    w.ledger.push({
      id: nextLedgerId++,
      type: "signup_bonus",
      amount: 2,
      balanceAfter: w.balance,
      analysisJobId: null,
      idempotencyKey: idem,
      metadata: null,
    });

    return { walletId: w.id, balance: w.balance };
  });
}

export async function memoryGetWalletBalance(clerkUserId: string): Promise<number> {
  return runSerialized(clerkUserId, async () => {
    const w = walletsByClerk.get(clerkUserId);
    return w?.balance ?? 0;
  });
}

export type MemorySpendOk = {
  ok: true;
  balanceAfter: number;
  walletId: number;
  ledgerId: number;
};

export type MemorySpendFail = { ok: false; code: "INSUFFICIENT_CREDITS" };

export async function memorySpendCredit(
  clerkUserId: string,
  jobId: string,
  cost: number
): Promise<MemorySpendOk | MemorySpendFail> {
  return runSerialized(clerkUserId, async () => {
    const w = walletsByClerk.get(clerkUserId);
    if (!w || w.balance < cost) {
      return { ok: false, code: "INSUFFICIENT_CREDITS" };
    }
    const idem = `spend:${jobId}`;
    const existing = w.ledger.find(l => l.idempotencyKey === idem);
    if (existing) {
      return { ok: true, balanceAfter: existing.balanceAfter, walletId: w.id, ledgerId: existing.id };
    }

    w.balance -= cost;
    const ledgerId = nextLedgerId++;
    w.ledger.push({
      id: ledgerId,
      type: "spend",
      amount: -cost,
      balanceAfter: w.balance,
      analysisJobId: jobId,
      idempotencyKey: idem,
      metadata: null,
    });
    return { ok: true, balanceAfter: w.balance, walletId: w.id, ledgerId };
  });
}

/** 분석 job 실패 시 spend 환급 (idempotent: refund:${jobId}) */
export async function memoryRefundSpendForJob(clerkUserId: string, jobId: string, cost: number): Promise<void> {
  return runSerialized(clerkUserId, async () => {
    const w = walletsByClerk.get(clerkUserId);
    if (!w) return;
    const idem = `refund:${jobId}`;
    if (w.ledger.some(l => l.idempotencyKey === idem)) return;

    const spend = w.ledger.find(l => l.idempotencyKey === `spend:${jobId}` && l.type === "spend");
    if (!spend) return;

    w.balance += cost;
    w.ledger.push({
      id: nextLedgerId++,
      type: "refund",
      amount: cost,
      balanceAfter: w.balance,
      analysisJobId: jobId,
      idempotencyKey: idem,
      metadata: JSON.stringify({ reason: "analysis_job_failed" }),
    });
  });
}

export function memoryCountSignupBonuses(clerkUserId: string): number {
  const w = walletsByClerk.get(clerkUserId);
  if (!w) return 0;
  return w.ledger.filter(l => l.type === "signup_bonus").length;
}
