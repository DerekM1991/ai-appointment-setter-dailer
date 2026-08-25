import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { usageCounters } from "@/db/schema";
import { monthlyPeriodKey } from "./plans";

type Db = ReturnType<typeof getDb>;
type Metric = "contactsImported" | "callsStarted" | "callMinutes" | "aiTurns";

export async function usageValue(db: Db, organizationId: string, metric: Metric): Promise<number> {
  const [row] = await db.select({ value: usageCounters[metric] }).from(usageCounters).where(and(eq(usageCounters.organizationId, organizationId), eq(usageCounters.periodKey, monthlyPeriodKey()))).limit(1);
  return Number(row?.value ?? 0);
}

export async function incrementUsage(db: Db, organizationId: string, metric: Metric, amount = 1) {
  const periodKey = monthlyPeriodKey(); const now = Date.now();
  await db.insert(usageCounters).values({ organizationId, periodKey, contactsImported: metric === "contactsImported" ? amount : 0, callsStarted: metric === "callsStarted" ? amount : 0, callMinutes: metric === "callMinutes" ? amount : 0, aiTurns: metric === "aiTurns" ? amount : 0, updatedAt: now }).onConflictDoUpdate({ target: [usageCounters.organizationId, usageCounters.periodKey], set: { [metric]: sql`${usageCounters[metric]} + ${amount}`, updatedAt: now } });
}
