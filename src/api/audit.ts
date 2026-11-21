import { ok } from "./_http";
import { requireRole } from "../../server/http/guard";
import { listAudit } from "../../db/queries/audit";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  const params = new URL(request.url).searchParams;
  const before = Number(params.get("before") ?? "");
  const rows = await listAudit({
    q: params.get("q")?.slice(0, 200) || undefined,
    action: params.get("action") || undefined,
    before: Number.isFinite(before) && before > 0 ? before : undefined,
    limit: Number(params.get("limit") ?? 50) || 50,
  });
  return ok({ entries: rows, next: rows.length ? rows[rows.length - 1]!.id : null });
}
