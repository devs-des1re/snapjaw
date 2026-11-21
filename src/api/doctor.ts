import { ok } from "./_http";
import { requireRole } from "../../server/http/guard";
import { runDoctor } from "../../server/ops/doctor";

export const maxDuration = 120;

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  return ok(await runDoctor());
}
