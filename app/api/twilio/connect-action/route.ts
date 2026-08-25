import { getRuntimeEnv } from "@/lib/env";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveTwilioCredentials } from "@/lib/integrations";
import { twiml, validateTwilioRequest } from "@/lib/twilio";

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const callId = new URL(request.url).searchParams.get("callId");
  if (!callId) return new Response("Missing call.", { status: 400 });
  const db = getDb();
  const [call] = await db.select({ organizationId: calls.organizationId }).from(calls).where(eq(calls.id, callId)).limit(1);
  const form = new URLSearchParams(await request.text());
  const credentials = call ? await resolveTwilioCredentials(db, runtime, call.organizationId).catch(() => null) : null;
  if (!credentials || !(await validateTwilioRequest(request, credentials.authToken, form))) {
    return new Response("Invalid Twilio signature.", { status: 403 });
  }
  return twiml("<Hangup/>");
}
