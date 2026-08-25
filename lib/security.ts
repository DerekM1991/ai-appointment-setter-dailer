import type { getDb } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

export function verifySameOrigin(request: Request): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  const referer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
  if (origin ? origin !== expected : !referer || safeOrigin(referer) !== expected) return Response.json({ error: "Missing or invalid same-origin request evidence." }, { status: 403 });
  return null;
}

function safeOrigin(value: string): string | null { try { return new URL(value).origin; } catch { return null; } }

export async function enforceRateLimit(input: {
  db: Db;
  key: string;
  limit: number;
  windowMs: number;
}): Promise<Response | null> {
  const bucket = Math.floor(Date.now() / input.windowMs);
  const key = `rate:${input.key}:${bucket}`;
  const [existing] = await input.db.select().from(settings).where(eq(settings.key, key)).limit(1);
  const count = existing ? Number.parseInt(existing.valueJson, 10) || 0 : 0;
  if (count >= input.limit) {
    return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "retry-after": String(Math.ceil(input.windowMs / 1000)) } });
  }
  await input.db.insert(settings).values({ key, valueJson: String(count + 1), updatedAt: Date.now() }).onConflictDoUpdate({ target: settings.key, set: { valueJson: String(count + 1), updatedAt: Date.now() } });
  return null;
}
