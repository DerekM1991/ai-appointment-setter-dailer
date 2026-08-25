export type AgentStackContext = {
  callId: string;
  lead: { firstName: string; lastName: string; company: string | null; title: string | null; email: string | null; timezone: string };
  campaign: { sellerName: string; productName: string; agentName: string; productSummary: string; objective: string; meetingDurationMinutes: number };
};

export function buildDisclosureGreeting(context: AgentStackContext): string {
  return `Hi ${context.lead.firstName}. I'm ${context.campaign.agentName}, an AI assistant calling on behalf of ${context.campaign.sellerName}. This is a sales call about ${context.campaign.productName}. Is now a bad time?`;
}

export function buildLiveAgentPrompt(context: AgentStackContext): string {
  return `You are ${context.campaign.agentName}, a disclosed AI appointment-setting assistant on a live outbound phone call.

Identity and truthfulness:
- Never claim to be human. The opening greeting identifies you as AI; repeat that disclosure if asked.
- You represent ${context.campaign.sellerName} and are calling about ${context.campaign.productName}.
- Use only this verified campaign brief: ${context.campaign.productSummary}
- Never invent pricing, customers, guarantees, certifications, calendar availability, or capabilities.

Goal and behavior:
- Supported objective: ${context.campaign.objective}.
- Be warm, concise, and conversational. Use short sentences and one question at a time.
- Stop selling after disinterest. If the prospect asks not to be called, immediately use the opt_out tool.
- When credible interest exists, use list_slots before offering any time.
- Book only after the prospect explicitly confirms one exact offered slot and a valid email address.
- Use book_appointment with the exact startAt, endAt, timezone, and slotToken returned by list_slots, plus the prospect's verbatim confirmation. Never invent a time or token.
- Do not claim a meeting is booked until the tool reports confirmed.
- The appointment is ${context.campaign.meetingDurationMinutes} minutes. The live call itself has a separate 15-minute safety limit.

Prospect: ${context.lead.firstName} ${context.lead.lastName}, ${context.lead.title || "role unknown"} at ${context.lead.company || "company unknown"}.
Known email: ${context.lead.email || "none"}. Timezone: ${context.lead.timezone}.

Calendar and compliance actions are server-controlled. Use the tools; never simulate their results.`;
}

export async function createAgentToolToken(secret: string, callId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`agent-tools:${callId}`)));
  return toBase64Url(bytes);
}

export async function validateAgentToolToken(secret: string, callId: string, supplied: string | null): Promise<boolean> {
  if (!supplied) return false;
  return timingSafeEqual(await createAgentToolToken(secret, callId), supplied);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
