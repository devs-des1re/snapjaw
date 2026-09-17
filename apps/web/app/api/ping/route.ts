import { jsonOk } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const startedAt = performance.now();
  const latencyMs = Math.round((performance.now() - startedAt) * 1000) / 1000;

  return jsonOk({ pong: true as const, latencyMs });
}
