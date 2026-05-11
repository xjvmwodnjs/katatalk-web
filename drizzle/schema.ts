import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
