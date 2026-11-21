import { ok } from "./_http";
import { requireRole } from "../../server/http/guard";
import { dashboard } from "../../server/ops/dashboard";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  return ok(await dashboard());
}
