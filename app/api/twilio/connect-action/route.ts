import { getRuntimeEnv } from "@/lib/env";
import { twiml, validateTwilioRequest } from "@/lib/twilio";

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const form = new URLSearchParams(await request.text());
  if (!(await validateTwilioRequest(request, runtime.TWILIO_AUTH_TOKEN, form))) {
    return new Response("Invalid Twilio signature.", { status: 403 });
  }
  return twiml("<Hangup/>");
}
