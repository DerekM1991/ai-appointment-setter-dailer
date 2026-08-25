import type { RuntimeEnv } from "./env";
import type { AvailableSlot } from "./outlook";

export type TranscriptTurn = {
  role: "assistant" | "user";
  text: string;
  at: number;
};

export type AgentDecision = {
  reply: string;
  action: "none" | "list_slots" | "book_appointment" | "opt_out" | "end";
  selectedStartAt: string;
  email: string;
  outcome: "none" | "interested" | "not_interested" | "callback";
};

export async function decideAgentTurn(input: {
  runtime: RuntimeEnv;
  lead: {
    firstName: string;
    lastName: string;
    company: string | null;
    title: string | null;
    email: string | null;
    timezone: string;
  };
  campaign: {
    sellerName: string;
    productName: string;
    agentName: string;
    productSummary: string;
    objective: string;
    meetingDurationMinutes: number;
  };
  transcript: TranscriptTurn[];
  availableSlots: AvailableSlot[];
}): Promise<AgentDecision> {
  const apiKey = input.runtime.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const offered = input.availableSlots.length
    ? input.availableSlots
        .map((slot) => `${slot.label} [start=${slot.startAt}]`)
        .join("\n")
    : "No calendar slots have been retrieved yet.";
  const system = `You are ${input.campaign.agentName}, an AI appointment-setting assistant on a live outbound phone call.

Identity and transparency:
- You are an AI assistant, never a human. The mandatory opening greeting already disclosed this. If asked, clearly repeat that you are AI.
- You represent ${input.campaign.sellerName} and are calling about ${input.campaign.productName}. Do not impersonate a human or another named person.

Goal:
- Briefly determine whether the prospect has a credible need for the campaign offer described below.
- If there is credible interest, offer a ${input.campaign.meetingDurationMinutes}-minute discovery meeting and schedule it only after the prospect explicitly confirms one exact time and their email address.

Behavior:
- Sound warm, concise, and conversational. Use contractions, short sentences, and one question at a time.
- Never invent pricing, customers, legal compliance, inspections, certifications, calendar availability, or product capabilities.
- Do not pressure, argue, or continue a sales pitch after disinterest.
- If the person asks not to be called, use action opt_out immediately and give a brief confirmation. Do not ask why.
- If the person is not interested, use action end. Do not treat simple disinterest as an opt-out unless they ask for no more calls.
- Use action list_slots only when the person agrees to discuss scheduling.
- Use action book_appointment only when the latest prospect turn explicitly confirms one exact offered slot and supplies or confirms a valid email.
- The selectedStartAt must exactly match one of the offered start values. Never create your own slot.
- Do not say an appointment is booked until the application reports success; phrase a booking action as "I’ll lock that in now."

Campaign brief: ${input.campaign.productSummary}
Objective: ${input.campaign.objective}
Prospect: ${input.lead.firstName} ${input.lead.lastName}, ${input.lead.title || "role unknown"} at ${input.lead.company || "company unknown"}.
Known email: ${input.lead.email || "none"}. Timezone: ${input.lead.timezone}.

Currently offered slots:
${offered}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.runtime.OPENAI_MODEL?.trim() || "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 500,
      input: [
        { role: "system", content: system },
        ...input.transcript.slice(-20).map((turn) => ({
          role: turn.role,
          content: turn.text,
        })),
      ],
      text: {
        format: {
          type: "json_schema",
          name: "appointment_setter_call_turn",
          strict: true,
          schema: {
            type: "object",
            properties: {
              reply: { type: "string" },
              action: {
                type: "string",
                enum: [
                  "none",
                  "list_slots",
                  "book_appointment",
                  "opt_out",
                  "end",
                ],
              },
              selectedStartAt: { type: "string" },
              email: { type: "string" },
              outcome: {
                type: "string",
                enum: ["none", "interested", "not_interested", "callback"],
              },
            },
            required: ["reply", "action", "selectedStartAt", "email", "outcome"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(
      `OpenAI response failed (${response.status}): ${error?.message || "Unknown error"}`,
    );
  }
  const text = extractOutputText(payload);
  if (!text) throw new Error("OpenAI returned no structured response.");
  const decision = JSON.parse(text) as AgentDecision;
  if (!decision.reply || !decision.action) {
    throw new Error("OpenAI returned an incomplete structured response.");
  }
  return decision;
}

function extractOutputText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output as Array<Record<string, unknown>>) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as Array<Record<string, unknown>>) {
      if (part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }
  return null;
}
