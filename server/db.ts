import { eq, and, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, analysisHistory, InsertAnalysisHistory } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    // New users get default subscription values from schema defaults
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Subscription Management ───

/** Get user's subscription info */
export async function getUserSubscription(userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select({
      subscriptionTier: users.subscriptionTier,
      remainingAnalysisCount: users.remainingAnalysisCount,
      maxAnalysisCount: users.maxAnalysisCount,
      subscriptionStartDate: users.subscriptionStartDate,
      preferredLanguage: users.preferredLanguage,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/** Decrement analysis count when user performs an analysis */
export async function decrementAnalysisCount(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const user = await db.select({ remaining: users.remainingAnalysisCount }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || user[0].remaining <= 0) return false;

  await db.update(users).set({
    remainingAnalysisCount: user[0].remaining - 1,
  }).where(eq(users.id, userId));

  return true;
}

/** Update user's subscription tier and reset analysis count */
export async function updateSubscriptionTier(userId: number, tier: "free" | "basic" | "premium") {
  const db = await getDb();
  if (!db) return;

  const maxCounts = { free: 3, basic: 30, premium: 100 };
  const maxCount = maxCounts[tier];

  await db.update(users).set({
    subscriptionTier: tier,
    remainingAnalysisCount: maxCount,
    maxAnalysisCount: maxCount,
    subscriptionStartDate: new Date(),
  }).where(eq(users.id, userId));
}

/** Update user's preferred language */
export async function updatePreferredLanguage(userId: number, language: string) {
  const db = await getDb();
  if (!db) return;

  await db.update(users).set({ preferredLanguage: language }).where(eq(users.id, userId));
}

// ─── Analysis History ───

/** Create a new analysis record */
export async function createAnalysis(data: InsertAnalysisHistory) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.insert(analysisHistory).values(data);
  return result[0]?.insertId;
}

/** Get user's analysis history */
export async function getUserAnalysisHistory(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(analysisHistory)
    .where(eq(analysisHistory.userId, userId))
    .orderBy(analysisHistory.createdAt)
    .limit(limit);
}
