import { fail, ok } from "../_http";
import { acceptInvite } from "../../../server/admin/admins";
import { findOpenInvite } from "../../../db/queries/invites";
import { isSameOrigin, readJson, requestInfo } from "../../../server/http/request";
import { badRequest, respond } from "../../../server/http/respond";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const invite = token ? await findOpenInvite(token) : null;
  if (!invite) return fail("This invite has expired or was already used.", 404);
  return ok({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail("Cross-site request blocked.", 403);
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await acceptInvite(body, requestInfo(request)), 201);
}
