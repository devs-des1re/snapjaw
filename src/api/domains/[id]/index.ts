import { fail, ok } from "../../_http";
import { requireRole } from "../../../../server/http/guard";
import { getDomainRow } from "../../../../db/queries/domains";
import { removeDomain } from "../../../../server/domains/service";
import { respond } from "../../../../server/http/respond";

export async function GET(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  const row = await getDomainRow(context.params.id);
  return row ? ok(row) : fail("No such domain.", 404);
}

export async function DELETE(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const alsoInResend = new URL(request.url).searchParams.get("resend") === "true";
  return respond(await removeDomain(actor, context.params.id, alsoInResend));
}
