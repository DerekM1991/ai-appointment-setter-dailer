import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { leads } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { mapWorkbookRows, type WorkbookRow } from "@/lib/import";
import { writeAuditEvent } from "@/lib/audit";
import { verifySameOrigin } from "@/lib/security";
import { hasPermission, permissionDenied } from "@/lib/tenant";
import { incrementUsage } from "@/lib/usage";

export async function POST(request: Request) {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  const originError = verifySameOrigin(request);
  if (originError) return originError;
  if (!hasPermission(auth, "prospects:write")) return permissionDenied("prospects:write");
  try {
    const payload = (await request.json()) as { rows?: WorkbookRow[]; sourceFile?: string };
    if (!Array.isArray(payload.rows) || payload.rows.length < 2) {
      return Response.json({ error: "The workbook has no data rows." }, { status: 400 });
    }
    if (payload.rows.length > 2_001) {
      return Response.json(
        { error: "Import at most 2,000 prospects per workbook." },
        { status: 413 },
      );
    }
    const mapped = mapWorkbookRows(payload.rows);
    const db = getDb();
    const [currentCount] = await db.select({ value: count() }).from(leads).where(eq(leads.organizationId, auth.organizationId));
    const existingPhones = new Set<string>();
    for (const chunk of chunks(mapped.leads.map((lead) => lead.phoneE164), 80)) {
      if (!chunk.length) continue;
      const existing = await db
        .select({ phone: leads.phoneE164 })
        .from(leads)
        .where(and(eq(leads.organizationId, auth.organizationId), inArray(leads.phoneE164, chunk)));
      for (const row of existing) existingPhones.add(row.phone);
    }
    const newLeads = mapped.leads.filter((lead) => !existingPhones.has(lead.phoneE164));
    const remaining = Math.max(0, auth.plan.prospects - Number(currentCount?.value ?? 0));
    if (newLeads.length > remaining) throw new Error(`${auth.plan.name} allows ${auth.plan.prospects.toLocaleString()} prospects. This import exceeds the remaining ${remaining.toLocaleString()} slots.`);
    const now = Date.now();
    for (const chunk of chunks(newLeads, 75)) {
      if (!chunk.length) continue;
      await db
        .insert(leads)
        .values(
          chunk.map((lead) => ({
            id: crypto.randomUUID(),
            organizationId: auth.organizationId,
            createdByUserId: auth.userId,
            firstName: lead.firstName,
            lastName: lead.lastName,
            company: lead.company,
            title: lead.title,
            phoneE164: lead.phoneE164,
            email: lead.email,
            timezone: lead.timezone,
            stateRegion: lead.stateRegion,
            countryCode: lead.countryCode,
            lineType: lead.lineType,
            consentStatus: lead.consentStatus,
            consentCapturedAt: lead.consentCapturedAt,
            consentSource: lead.consentSource,
            consentEvidence: lead.consentEvidence,
            dncCheckedAt: lead.dncCheckedAt,
            internalDnc: lead.internalDnc,
            status: (lead.complianceReasons.length ? "blocked" : "eligible") as
              | "blocked"
              | "eligible",
            blockReasonsJson: JSON.stringify(lead.complianceReasons),
            notes: lead.notes,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing({ target: [leads.organizationId, leads.phoneE164] });
    }
    const eligible = newLeads.filter((lead) => !lead.complianceReasons.length).length;
    const blocked = newLeads.length - eligible;
    await writeAuditEvent(db, {
      organizationId: auth.organizationId,
      actor: auth.email,
      eventType: "prospects_imported",
      entityType: "lead_batch",
      details: {
        sourceFile: String(payload.sourceFile ?? "workbook").slice(0, 120),
        inserted: newLeads.length,
        eligible,
        blocked,
        duplicates: mapped.leads.length - newLeads.length,
        rejected: mapped.rejected.length,
      },
    });
    await incrementUsage(db, auth.organizationId, "contactsImported", newLeads.length);
    return Response.json({
      inserted: newLeads.length,
      eligible,
      blocked,
      duplicates: mapped.leads.length - newLeads.length,
      rejected: mapped.rejected,
    });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
