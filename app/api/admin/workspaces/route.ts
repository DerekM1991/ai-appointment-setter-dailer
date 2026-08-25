import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, memberships, organizations, usageCounters, users } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { monthlyPeriodKey } from "@/lib/plans";
import { verifySameOrigin } from "@/lib/security";

export async function GET() {
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (auth.platformRole !== "super_admin") return Response.json({ error: "Platform administrator access required." }, { status: 403 });
  const db = getDb();
  const rows = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status, planKey: organizations.planKey, subscriptionStatus: organizations.subscriptionStatus, trialEndsAt: organizations.trialEndsAt, billingOverrideType: organizations.billingOverrideType, billingDiscountPercent: organizations.billingDiscountPercent, billingOverrideStartsAt: organizations.billingOverrideStartsAt, billingOverrideEndsAt: organizations.billingOverrideEndsAt, billingOverrideNote: organizations.billingOverrideNote, createdAt: organizations.createdAt }).from(organizations).orderBy(desc(organizations.createdAt));
  const workspaces = await Promise.all(rows.map(async (workspace) => {
    const [[members], [callCount], [owner], [usage]] = await Promise.all([
      db.select({ value: count() }).from(memberships).where(and(eq(memberships.organizationId, workspace.id), eq(memberships.status, "active"))),
      db.select({ value: count() }).from(calls).where(eq(calls.organizationId, workspace.id)),
      db.select({ email: users.email }).from(memberships).innerJoin(users, eq(memberships.userId, users.id)).where(and(eq(memberships.organizationId, workspace.id), eq(memberships.role, "owner"))).limit(1),
      db.select().from(usageCounters).where(and(eq(usageCounters.organizationId, workspace.id), eq(usageCounters.periodKey, monthlyPeriodKey()))).limit(1),
    ]);
    return { ...workspace, ownerEmail: owner?.email ?? null, memberCount: Number(members?.value ?? 0), callCount: Number(callCount?.value ?? 0), usage: usage ?? { callsStarted: 0, contactsImported: 0, callMinutes: 0, aiTurns: 0 } };
  }));
  return Response.json({ workspaces });
}

export async function PATCH(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (auth.platformRole !== "super_admin") return Response.json({ error: "Platform administrator access required." }, { status: 403 });
  try {
    const payload = (await request.json()) as { organizationId?: string; name?: string; status?: "active" | "suspended"; planKey?: "trial" | "starter" | "growth" | "pro"; subscriptionStatus?: "trialing" | "active" | "past_due" | "canceled" | "incomplete"; billingOverrideType?: "none" | "complimentary" | "discount"; billingDiscountPercent?: number; billingOverrideStartsAt?: number | null; billingOverrideEndsAt?: number | null; billingOverrideNote?: string; resetMonthlyUsage?: boolean };
    if (!payload.organizationId) throw new Error("Choose a workspace.");
    const db = getDb();
    if (payload.resetMonthlyUsage) {
      await db.delete(usageCounters).where(and(eq(usageCounters.organizationId, payload.organizationId), eq(usageCounters.periodKey, monthlyPeriodKey())));
      await writeAuditEvent(db, { organizationId: payload.organizationId, actor: auth.email, eventType: "platform_usage_reset", entityType: "organization", entityId: payload.organizationId, details: { periodKey: monthlyPeriodKey() } });
      return Response.json({ updated: true });
    }
    const updates: Partial<typeof organizations.$inferInsert> & { updatedAt: number } = { updatedAt: Date.now() };
    if (payload.name?.trim()) updates.name = payload.name.trim().slice(0, 120);
    if (payload.status && ["active", "suspended"].includes(payload.status)) updates.status = payload.status;
    if (payload.planKey && ["trial", "starter", "growth", "pro"].includes(payload.planKey)) updates.planKey = payload.planKey;
    if (payload.subscriptionStatus && ["trialing", "active", "past_due", "canceled", "incomplete"].includes(payload.subscriptionStatus)) updates.subscriptionStatus = payload.subscriptionStatus;
    if (payload.billingOverrideType) {
      if (!["none", "complimentary", "discount"].includes(payload.billingOverrideType)) throw new Error("Choose a valid access grant type.");
      const startsAt = payload.billingOverrideStartsAt ? Number(payload.billingOverrideStartsAt) : Date.now();
      const endsAt = payload.billingOverrideEndsAt ? Number(payload.billingOverrideEndsAt) : null;
      if (endsAt && endsAt <= startsAt) throw new Error("The access grant end must be after its start.");
      const discount = payload.billingOverrideType === "discount" ? Math.floor(Number(payload.billingDiscountPercent)) : payload.billingOverrideType === "complimentary" ? 100 : 0;
      if (payload.billingOverrideType === "discount" && (discount < 1 || discount > 99)) throw new Error("Discount must be between 1% and 99%.");
      updates.billingOverrideType = payload.billingOverrideType;
      updates.billingDiscountPercent = discount;
      updates.billingOverrideStartsAt = payload.billingOverrideType === "none" ? null : startsAt;
      updates.billingOverrideEndsAt = payload.billingOverrideType === "none" ? null : endsAt;
      updates.billingOverrideNote = payload.billingOverrideType === "none" ? null : payload.billingOverrideNote?.trim().slice(0, 500) || null;
      if (payload.billingOverrideType === "complimentary") updates.subscriptionStatus = "active";
    }
    await db.update(organizations).set(updates).where(eq(organizations.id, payload.organizationId));
    await writeAuditEvent(db, { organizationId: payload.organizationId, actor: auth.email, eventType: "platform_workspace_updated", entityType: "organization", entityId: payload.organizationId, details: updates });
    return Response.json({ updated: true });
  } catch (error) { return errorResponse(error, 400); }
}
