import { ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { listMessages } from "../../../db/queries/messages";

function date(value: string | null, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  const params = new URL(request.url).searchParams;
  const rows = await listMessages({
    direction: params.get("direction") || undefined,
    status: params.get("status") || undefined,
    q: params.get("q")?.slice(0, 200) || undefined,
    from: date(params.get("from")),
    to: date(params.get("to"), true),
    before: params.get("before") || undefined,
    limit: Number(params.get("limit") ?? 50) || 50,
  });
  return ok({ messages: rows, next: rows.length >= 50 ? rows[rows.length - 1]!.id : null });
}
