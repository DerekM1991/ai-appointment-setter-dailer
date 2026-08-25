import { getDb } from "@/db";
import { executeAppointmentAgentTool, type AppointmentAgentTool } from "@/lib/appointment-agent-tools";
import { validateAgentToolToken } from "@/lib/agent-stack";
import { getRuntimeEnv } from "@/lib/env";

const tools = new Set<AppointmentAgentTool>(["list_slots", "book_appointment", "opt_out", "end_call"]);

export async function POST(request: Request) {
  try {
    const runtime = getRuntimeEnv();
    if (!runtime.APP_ENCRYPTION_KEY) return Response.json({ error: "Agent tools are not configured." }, { status: 503 });
    const payload = (await request.json()) as { callId?: string; tool?: string; arguments?: Record<string, unknown>; token?: string };
    const callId = payload.callId?.trim();
    const tool = payload.tool as AppointmentAgentTool;
    const authorization = request.headers.get("authorization");
    const supplied = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : payload.token?.trim() || null;
    if (!callId || !tools.has(tool) || !(await validateAgentToolToken(runtime.APP_ENCRYPTION_KEY, callId, supplied))) {
      return Response.json({ error: "Unauthorized agent action." }, { status: 403 });
    }
    const result = await executeAppointmentAgentTool({ db: getDb(), runtime, callId, tool, arguments: payload.arguments ?? {} });
    return Response.json(result);
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message.slice(0, 400) : "Agent action failed." }, { status: 400 });
  }
}
