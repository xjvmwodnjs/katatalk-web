import type { AuthenticatedUser } from "./_core/sdk";
import { ENV } from "./_core/env";
import {
  dbEnsureWalletWithSignupBonus,
  dbGetWalletBalance,
  dbRefundSpendForJob,
  dbSpendCreditForJob,
} from "./creditDb";
import {
  memoryEnsureWalletWithSignupBonus,
  memoryGetWalletBalance,
  memoryRefundSpendForJob,
  memorySpendCredit,
} from "./creditMemoryStore";

const DEFAULT_ANALYSIS_COST = 1;

export function walletSubjectFromAuthUser(user: AuthenticatedUser): string {
  if (user.openId.startsWith("clerk:")) {
    return user.openId.slice("clerk:".length);
  }
  return `non-clerk:${user.openId}`;
}

function useMysqlWallet(): boolean {
  return Boolean(ENV.databaseUrl?.trim());
}

function useMemoryWallet(): boolean {
  return !useMysqlWallet() && !ENV.isProduction;
}

export async function ensureWalletWithSignupBonus(user: AuthenticatedUser): Promise<void> {
  const subject = walletSubjectFromAuthUser(user);
  const appUserId = user.id > 0 ? user.id : null;
  if (useMysqlWallet()) {
    await dbEnsureWalletWithSignupBonus(subject, appUserId);
    return;
  }
  if (useMemoryWallet()) {
    await memoryEnsureWalletWithSignupBonus(subject, appUserId);
    return;
  }
  throw new Error("운영 환경에서는 크레딧 지갑을 위해 DATABASE_URL 이 필요합니다.");
}

export async function getWalletBalance(user: AuthenticatedUser): Promise<number> {
  const subject = walletSubjectFromAuthUser(user);
  if (useMysqlWallet()) {
    await ensureWalletWithSignupBonus(user);
    return dbGetWalletBalance(subject);
  }
  if (useMemoryWallet()) {
    await memoryEnsureWalletWithSignupBonus(subject, user.id > 0 ? user.id : null);
    return memoryGetWalletBalance(subject);
  }
  throw new Error("운영 환경에서는 크레딧 조회를 위해 DATABASE_URL 이 필요합니다.");
}

export type SpendForAnalysisResult =
  | { ok: true; balanceAfter: number; ledgerId: number }
  | { ok: false; code: "INSUFFICIENT_CREDITS" };

export async function spendCreditForAnalysisJob(
  user: AuthenticatedUser,
  jobId: string,
  cost: number = DEFAULT_ANALYSIS_COST
): Promise<SpendForAnalysisResult> {
  const subject = walletSubjectFromAuthUser(user);
  if (useMysqlWallet()) {
    const r = await dbSpendCreditForJob(subject, jobId, cost);
    if (!r.ok) return r;
    return { ok: true, balanceAfter: r.balanceAfter, ledgerId: r.ledgerId };
  }
  if (useMemoryWallet()) {
    const r = await memorySpendCredit(subject, jobId, cost);
    if (!r.ok) return r;
    return { ok: true, balanceAfter: r.balanceAfter, ledgerId: r.ledgerId };
  }
  throw new Error("운영 환경에서는 크레딧 차감을 위해 DATABASE_URL 이 필요합니다.");
}

export async function refundCreditIfJobFailed(
  user: AuthenticatedUser,
  jobId: string,
  cost: number = DEFAULT_ANALYSIS_COST
): Promise<void> {
  const subject = walletSubjectFromAuthUser(user);
  if (useMysqlWallet()) {
    await dbRefundSpendForJob(subject, jobId, cost);
    return;
  }
  if (useMemoryWallet()) {
    await memoryRefundSpendForJob(subject, jobId, cost);
  }
}
