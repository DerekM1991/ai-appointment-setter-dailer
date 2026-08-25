import type { AiProvider, TelephonyProvider } from "./integrations";

export const VOICE_STACKS = [
  {
    key: "twilio_openai",
    label: "Twilio + OpenAI",
    telephonyProvider: "twilio",
    aiProvider: "openai",
    maturity: "Production",
    description: "ConversationRelay with structured qualification and in-call calendar tools.",
  },
  {
    key: "telnyx_elevenlabs",
    label: "Telnyx + ElevenLabs",
    telephonyProvider: "telnyx",
    aiProvider: "elevenlabs",
    maturity: "Beta",
    description: "Telnyx SIP trunking with ElevenLabs Agents for natural, high-quality voice.",
  },
  {
    key: "telnyx_gemini",
    label: "Telnyx + Gemini Live",
    telephonyProvider: "telnyx",
    aiProvider: "gemini",
    maturity: "Preview",
    description: "Direct bidirectional PCM audio with Gemini Live speech-to-speech and calendar tools.",
  },
] as const;

export type VoiceStackKey = (typeof VOICE_STACKS)[number]["key"];

export function voiceStackFor(telephonyProvider: string, aiProvider: string) {
  return VOICE_STACKS.find((stack) => stack.telephonyProvider === telephonyProvider && stack.aiProvider === aiProvider) ?? VOICE_STACKS[0];
}

export function normalizeVoiceStack(value: unknown): { telephonyProvider: TelephonyProvider; aiProvider: AiProvider } {
  const selected = VOICE_STACKS.find((stack) => stack.key === value) ?? VOICE_STACKS[0];
  return { telephonyProvider: selected.telephonyProvider, aiProvider: selected.aiProvider };
}

export function assertSupportedVoiceStack(telephonyProvider: string, aiProvider: string): asserts telephonyProvider is TelephonyProvider {
  if (!VOICE_STACKS.some((stack) => stack.telephonyProvider === telephonyProvider && stack.aiProvider === aiProvider)) {
    throw new Error("Choose a supported voice stack.");
  }
}
