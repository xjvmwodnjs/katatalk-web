import { and, eq, gte, sql } from "drizzle-orm";
import type { ResultSetHeader } from "mysql2";
import { creditLedger, userWallets } from "../drizzle/schema";
import { getDb } from "./db";

function firstHeader(result: unknown): ResultSetHeader {
  return (Array.isArray(result) ? result[0] : result) as ResultSetHeader;
}

export async function dbEnsureWalletWithSignupBonus(
  clerkUserId: string,
  appUserId: number | null
): Promise<{ walletId: number; balance: number }> {
  const db = await getDb();
  if (!db) {
    throw new Error("DATABASE_URL is required for wallet operations.");
  }

  return db.transaction(async tx => {
    await tx
      .insert(userWallets)
      .ignore()
      .values({
        clerkUserId,
        userId: appUserId,
        balance: 0,
        signupBonusGranted: 0,
      });

    await tx.execute(
      sql`SELECT id FROM user_wallets WHERE clerkUserId = ${clerkUserId} FOR UPDATE`
    );

    const [w] = await tx
      .select()
      .from(userWallets)
      .where(eq(userWallets.clerkUserId, clerkUserId))
      .limit(1);
    if (!w) {
      throw new Error("user_wallets row missing after insert-ignore");
    }

    if (appUserId != null && w.userId == null) {
      await tx.update(userWallets).set({ userId: appUserId }).where(eq(userWallets.id, w.id));
    }

    const idem = `signup_bonus:${clerkUserId}`;
    const dup = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, idem))
      .limit(1);
    if (dup.length) {
      const [cur] = await tx
        .select({ balance: userWallets.balance })
        .from(userWallets)
        .where(eq(userWallets.id, w.id))
        .limit(1);
      return { walletId: w.id, balance: cur?.balance ?? w.balance };
    }

    const newBal = w.balance + 2;
    await tx
      .update(userWallets)
      .set({ balance: newBal, signupBonusGranted: 1 })
      .where(eq(userWallets.id, w.id));

    const ins = await tx.insert(creditLedger).values({
      walletId: w.id,
      type: "signup_bonus",
      amount: 2,
      balanceAfter: newBal,
      analysisJobId: null,
      idempotencyKey: idem,
      metadata: null,
    });

    const ledgerId = firstHeader(ins).insertId;
    void ledgerId;

    return { walletId: w.id, balance: newBal };
  });
}

export async function dbGetWalletBalance(clerkUserId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ balance: userWallets.balance })
    .from(userWallets)
    .where(eq(userWallets.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0]?.balance ?? 0;
}

export type DbSpendOk = {
  ok: true;
  balanceAfter: number;
  walletId: number;
  ledgerId: number;
};

export type DbSpendFail = { ok: false; code: "INSUFFICIENT_CREDITS" };

export async function dbSpendCreditForJob(
  clerkUserId: string,
  jobId: string,
  cost: number
): Promise<DbSpendOk | DbSpendFail> {
  const db = await getDb();
  if (!db) {
    throw new Error("DATABASE_URL is required for wallet spend.");
  }

  return db.transaction(async tx => {
    await tx.execute(
      sql`SELECT id FROM user_wallets WHERE clerkUserId = ${clerkUserId} FOR UPDATE`
    );

    const [w] = await tx
      .select()
      .from(userWallets)
      .where(eq(userWallets.clerkUserId, clerkUserId))
      .limit(1);
    if (!w) {
      return { ok: false, code: "INSUFFICIENT_CREDITS" };
    }

    const spendKey = `spend:${jobId}`;
    const existingSpend = await tx
      .select({ id: creditLedger.id, balanceAfter: creditLedger.balanceAfter })
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, spendKey))
      .limit(1);
    if (existingSpend.length) {
      return {
        ok: true,
        balanceAfter: existingSpend[0]!.balanceAfter,
        walletId: w.id,
        ledgerId: existingSpend[0]!.id,
      };
    }

    const upd = await tx
      .update(userWallets)
      .set({
        balance: sql`${userWallets.balance} - ${cost}`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(userWallets.id, w.id), gte(userWallets.balance, cost)));

    if (firstHeader(upd).affectedRows !== 1) {
      return { ok: false, code: "INSUFFICIENT_CREDITS" };
    }

    const [after] = await tx
      .select({ balance: userWallets.balance })
      .from(userWallets)
      .where(eq(userWallets.id, w.id))
      .limit(1);
    const balanceAfter = after?.balance ?? w.balance - cost;

    const ins = await tx.insert(creditLedger).values({
      walletId: w.id,
      type: "spend",
      amount: -cost,
      balanceAfter,
      analysisJobId: jobId,
      idempotencyKey: spendKey,
      metadata: null,
    });

    const ledgerId = Number(firstHeader(ins).insertId);

    return { ok: true, balanceAfter, walletId: w.id, ledgerId };
  });
}

export async function dbRefundSpendForJob(clerkUserId: string, jobId: string, cost: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.transaction(async tx => {
    await tx.execute(
      sql`SELECT id FROM user_wallets WHERE clerkUserId = ${clerkUserId} FOR UPDATE`
    );

    const [w] = await tx
      .select()
      .from(userWallets)
      .where(eq(userWallets.clerkUserId, clerkUserId))
      .limit(1);
    if (!w) return;

    const refundKey = `refund:${jobId}`;
    const dup = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, refundKey))
      .limit(1);
    if (dup.length) return;

    const spend = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(eq(creditLedger.analysisJobId, jobId), eq(creditLedger.type, "spend")))
      .limit(1);
    if (!spend.length) return;

    const newBal = w.balance + cost;
    await tx.update(userWallets).set({ balance: newBal }).where(eq(userWallets.id, w.id));

    await tx.insert(creditLedger).values({
      walletId: w.id,
      type: "refund",
      amount: cost,
      balanceAfter: newBal,
      analysisJobId: jobId,
      idempotencyKey: refundKey,
      metadata: JSON.stringify({ reason: "analysis_job_failed" }),
    });
  });
}
