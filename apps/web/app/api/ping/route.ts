import { jsonOk } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * Reports how long the server spent producing this response, in milliseconds.
 * It measures server-side handling only — the network leg is not observable
 * from here.
 */
export function GET(): Response {
  const startedAt = performance.now();
  const payload = { pong: true as const, latencyMs: 0 };

  const latencyMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  return jsonOk({ ...payload, latencyMs });
}
