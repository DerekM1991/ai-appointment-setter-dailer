import type { getDb } from "@/db";
import { auditEvents } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

export async function writeAuditEvent(
  db: Db,
  input: {
    organizationId?: string;
    actor: string;
    eventType: string;
    entityType?: string;
    entityId?: string;
    details?: Record<string, unknown>;
  },
) {
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId ?? "legacy",
    actor: input.actor,
    eventType: input.eventType,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    detailsJson: JSON.stringify(input.details ?? {}),
    createdAt: Date.now(),
  });
}
