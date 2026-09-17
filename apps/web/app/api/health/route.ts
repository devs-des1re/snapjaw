import { jsonOk } from "@/lib/api/response";

export const dynamic = "force-dynamic";

// Deliberately does not touch the database, so it keeps answering during an outage.
export function GET(): Response {
  return jsonOk({ status: "ok" });
}
