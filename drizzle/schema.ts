import { int, mysqlEnum, mysqlTable, text, timestamp, tinyint, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extended with subscription management fields for KataTalk service.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),

  // ─── Subscription Management ───
  /** User's subscription tier: free, basic, or premium */
  subscriptionTier: mysqlEnum("subscriptionTier", ["free", "basic", "premium"]).default("free").notNull(),
  /** Number of remaining analysis credits for the current billing period */
  remainingAnalysisCount: int("remainingAnalysisCount").default(2).notNull(),
  /** Maximum analysis count per billing period based on tier */
  maxAnalysisCount: int("maxAnalysisCount").default(3).notNull(),
  /** Subscription period start date (for monthly reset tracking) */
  subscriptionStartDate: timestamp("subscriptionStartDate"),
  /** Preferred language for AI commentary output */
  preferredLanguage: varchar("preferredLanguage", { length: 5 }).default("ko"),

  // ─── Timestamps ───
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Analysis history table - tracks each SGF analysis performed by users.
 */
export const analysisHistory = mysqlTable("analysis_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Original SGF filename */
  fileName: varchar("fileName", { length: 255 }),
  /** S3 storage key for the uploaded SGF file */
  sgfStorageKey: varchar("sgfStorageKey", { length: 512 }),
  /** Analysis status */
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  /** Number of mistakes found */
  mistakeCount: int("mistakeCount").default(0),
  /** Language used for the analysis commentary */
  language: varchar("language", { length: 5 }).default("ko"),
  /** JSON result data (stored as text for flexibility) */
  resultJson: text("resultJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type AnalysisHistory = typeof analysisHistory.$inferSelect;
export type InsertAnalysisHistory = typeof analysisHistory.$inferInsert;

/** Clerk `sub` (JWT subject) — wallet 식별자. `clerk:` 접두사 없이 저장한다. */
export const userWallets = mysqlTable("user_wallets", {
  id: int("id").autoincrement().primaryKey(),
  clerkUserId: varchar("clerkUserId", { length: 128 }).notNull().unique(),
  /** users.id — DB 사용자와 연결 (선택) */
  userId: int("userId"),
  balance: int("balance").default(0).notNull(),
  signupBonusGranted: tinyint("signupBonusGranted").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserWallet = typeof userWallets.$inferSelect;
export type InsertUserWallet = typeof userWallets.$inferInsert;

export const creditLedgerEntryType = mysqlEnum("credit_ledger_type", [
  "signup_bonus",
  "purchase",
  "spend",
  "refund",
  "admin_adjustment",
]);

export const creditLedger = mysqlTable("credit_ledger", {
  id: int("id").autoincrement().primaryKey(),
  walletId: int("walletId").notNull(),
  type: creditLedgerEntryType.notNull(),
  /** 부호: bonus/purchase/refund 는 양수, spend 은 음수 권장 */
  amount: int("amount").notNull(),
  balanceAfter: int("balanceAfter").notNull(),
  analysisJobId: varchar("analysisJobId", { length: 64 }),
  idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull().unique(),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CreditLedgerRow = typeof creditLedger.$inferSelect;
export type InsertCreditLedger = typeof creditLedger.$inferInsert;
