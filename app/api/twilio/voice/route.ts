import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { campaigns, calls, leads } from "@/db/schema";
import { getRuntimeEnv, normalizedBaseUrl } from "@/lib/env";
import { validateTwilioRequest, twiml, xmlEscape } from "@/lib/twilio";

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const form = new URLSearchParams(await request.text());
  if (!(await validateTwilioRequest(request, runtime.TWILIO_AUTH_TOKEN, form))) {
    return new Response("Invalid Twilio signature.", { status: 403 });
  }
  const callId = new URL(request.url).searchParams.get("callId");
  if (!callId) return twiml("<Hangup/>");
  const db = getDb();
  const [record] = await db
    .select({
      id: calls.id,
      twilioCallSid: calls.twilioCallSid,
      leadId: leads.id,
      campaignId: campaigns.id,
      firstName: leads.firstName,
      sellerName: campaigns.sellerName,
      productName: campaigns.productName,
      agentName: campaigns.agentName,
    })
    .from(calls)
    .innerJoin(leads, eq(calls.leadId, leads.id))
    .innerJoin(campaigns, eq(calls.campaignId, campaigns.id))
    .where(eq(calls.id, callId))
    .limit(1);
  if (!record || (record.twilioCallSid && record.twilioCallSid !== form.get("CallSid"))) {
    return twiml("<Hangup/>");
  }
  const greeting = `Hi ${record.firstName}. I'm ${record.agentName}, an AI assistant calling on behalf of ${record.sellerName}. This is a sales call about ${record.productName}. Is now a bad time?`;
  const now = Date.now();
  await db
    .update(calls)
    .set({
      status: "in-progress",
      startedAt: now,
      aiDisclosureAt: now,
      transcriptJson: JSON.stringify([
        { role: "assistant", text: greeting, at: now },
      ]),
      updatedAt: now,
    })
    .where(eq(calls.id, callId));

  const baseUrl = normalizedBaseUrl(runtime, request);
  const socketUrl = baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const connectAction = `${baseUrl}/api/twilio/connect-action?callId=${encodeURIComponent(callId)}`;
  return twiml(
    `<Connect action="${xmlEscape(connectAction)}"><ConversationRelay url="${xmlEscape(`${socketUrl}/api/twilio/conversation`)}" welcomeGreeting="${xmlEscape(greeting)}" welcomeGreetingInterruptible="speech" language="en-US" interruptible="speech" interruptSensitivity="medium" reportInputDuringAgentSpeech="speech" ignoreBackchannel="true" hints="${xmlEscape(`${record.sellerName},${record.productName}`)}" events="tokens-played speaker-events"><Parameter name="callId" value="${xmlEscape(callId)}"/><Parameter name="leadId" value="${xmlEscape(record.leadId)}"/><Parameter name="campaignId" value="${xmlEscape(record.campaignId)}"/></ConversationRelay></Connect>`,
  );
}
