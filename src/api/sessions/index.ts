import { ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { listSessions } from "../../../db/queries/sessions";

function currentToken(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)(?:__Secure-)?snapjaw\.session-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer", { allowWithout2fa: true });
  if (actor instanceof Response) return actor;
  const token = currentToken(request);
  const rows = await listSessions(actor.id);
  return ok(
    rows.map(({ sessionToken, ...row }) => ({ ...row, current: sessionToken === token })),
  );
}

export { currentToken };
