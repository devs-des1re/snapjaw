import { jsonOk } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * Liveness check — deliberately does not touch the database, so it keeps
 * answering during a database outage.
 */
export function GET(): Response {
  return jsonOk({ status: "ok" });
}
