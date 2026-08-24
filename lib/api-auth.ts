import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getRuntimeEnv } from "./env";

export async function getAuthorizedApiUser(): Promise<
  | { ok: true; email: string; displayName: string }
  | { ok: false; response: Response }
> {
  const user = await getChatGPTUser();
  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "Authentication required." }, { status: 401 }),
    };
  }
  const owner = getRuntimeEnv().APP_OWNER_EMAIL?.trim().toLowerCase();
  if (owner && owner !== user.email.toLowerCase()) {
    return {
      ok: false,
      response: Response.json({ error: "This workspace is restricted to its owner." }, { status: 403 }),
    };
  }
  return { ok: true, email: user.email, displayName: user.displayName };
}

export function errorResponse(error: unknown, status = 400): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}
