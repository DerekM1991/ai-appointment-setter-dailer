import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { campaignLeads, campaigns, leads } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { getRuntimeEnv } from "@/lib/env";
import { resolveCallingLimits } from "@/lib/calling-limits";
import { normalizeCampaignObjective } from "@/lib/campaign-objectives";
import { writeAuditEvent } from "@/lib/audit";
import { verifySameOrigin } from "@/lib/security";
import { hasPermission, permissionDenied } from "@/lib/tenant";

export async function GET() {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  const db = getDb();
  return Response.json({
    campaigns: await db.select().from(campaigns).where(eq(campaigns.organizationId, auth.organizationId)).orderBy(desc(campaigns.createdAt)),
  });
}

export async function POST(request: Request) {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  const originError = verifySameOrigin(request);
  if (originError) return originError;
  if (!hasPermission(auth, "campaigns:write")) return permissionDenied("campaigns:write");
  try {
    const payload = (await request.json()) as {
      name?: string;
      sellerName?: string;
      productName?: string;
      agentName?: string;
      productSummary?: string;
      objective?: string;
      meetingDurationMinutes?: number;
    };
    const name = payload.name?.trim();
    const sellerName = payload.sellerName?.trim();
    const productName = payload.productName?.trim();
    const agentName = payload.agentName?.trim();
    const productSummary = payload.productSummary?.trim();
    if (!name || name.length > 100) throw new Error("Enter a campaign name under 100 characters.");
    if (!sellerName || sellerName.length > 100) throw new Error("Enter the seller or business name under 100 characters.");
    if (!productName || productName.length > 120) throw new Error("Enter the product or offer name under 120 characters.");
    if (!agentName || agentName.length > 40) throw new Error("Enter an agent name under 40 characters.");
    if (!productSummary || productSummary.length < 40 || productSummary.length > 2_000) {
      throw new Error("Enter a factual product brief between 40 and 2,000 characters.");
    }
    const db = getDb();
    const limits = await resolveCallingLimits(db, getRuntimeEnv(), auth.organizationId, auth.plan).catch(() => ({
      effectiveConcurrent: 1,
      effectiveCps: 1,
    }));
    const [campaignCount] = await db.select({ value: count() }).from(campaigns).where(eq(campaigns.organizationId, auth.organizationId));
    if (Number(campaignCount?.value ?? 0) >= auth.plan.campaigns) throw new Error(`${auth.plan.name} supports ${auth.plan.campaigns} campaigns.`);
    const eligible = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.organizationId, auth.organizationId), eq(leads.status, "eligible")));
    const now = Date.now();
    const id = crypto.randomUUID();
    await db.insert(campaigns).values({
      id,
      organizationId: auth.organizationId,
      createdByUserId: auth.userId,
      name,
      sellerName,
      productName,
      agentName,
      productSummary,
      objective: normalizeCampaignObjective(payload.objective),
      status: "draft",
      maxConcurrent: limits.effectiveConcurrent,
      callsPerSecond: limits.effectiveCps,
      meetingDurationMinutes: [15, 30, 45, 60].includes(
        Number(payload.meetingDurationMinutes),
      )
        ? Number(payload.meetingDurationMinutes)
        : 30,
      createdAt: now,
      updatedAt: now,
    });
    for (const chunk of chunks(eligible, 100)) {
      if (!chunk.length) continue;
      await db.insert(campaignLeads).values(
        chunk.map((lead, index) => ({
          campaignId: id,
          leadId: lead.id,
          status: "queued" as const,
          priority: index,
          createdAt: now,
        })),
      );
    }
    await writeAuditEvent(db, {
      organizationId: auth.organizationId,
      actor: auth.email,
      eventType: "campaign_created",
      entityType: "campaign",
      entityId: id,
      details: { eligibleProspectsQueued: eligible.length },
    });
    return Response.json({ id, queued: eligible.length }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
