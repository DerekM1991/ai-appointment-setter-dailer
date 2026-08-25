import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { ensureTenantContext, type TenantContext } from "./tenant";

export async function getAuthorizedApiUser(): Promise<
  | ({ ok: true } & TenantContext)
  | { ok: false; response: Response }
> {
  const user = await getChatGPTUser();
  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "Authentication required." }, { status: 401 }),
    };
  }
  try {
    return { ok: true, ...(await ensureTenantContext(getDb(), user)) };
  } catch (error) {
    return {
      ok: false,
      response: Response.json(
        { error: error instanceof Error ? error.message : "Account access denied." },
        { status: 403 },
      ),
    };
  }
}

export function errorResponse(error: unknown, status = 400): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}
