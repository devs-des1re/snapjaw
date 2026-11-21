import { and, eq, gt } from "drizzle-orm";
import { requireRole } from "../../../../server/http/guard";
import { db } from "../../../../db";
import { oauthStates } from "../../../../db/schema";
import { getDestination, setDestinationHealth, updateDestination, type GmailConfig } from "../../../../db/queries/destinations";
import { exchangeCode } from "../../../../server/destinations/gmail";
import { recordAudit } from "../../../../db/queries/audit";
import { logger } from "../../../../lib/logger";

function back(request: Request, query: string) {
  return new Response(null, { status: 303, headers: { location: new URL(`/destinations?${query}`, request.url).toString() } });
}

export async function GET(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return back(request, "gmail=signin");
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (params.get("error")) return back(request, `gmail=denied`);
  const stored = await db.query.oauthStates.findFirst({ where: and(eq(oauthStates.state, state), gt(oauthStates.expiresAt, new Date())) });
  await db.delete(oauthStates).where(eq(oauthStates.state, state));
  if (!stored || stored.createdBy !== actor.id || !code) return back(request, "gmail=expired");
  const destination = await getDestination(stored.destinationId);
  if (!destination || destination.type !== "gmail") return back(request, "gmail=missing");
  try {
    const result = await exchangeCode(code, stored.verifier);
    const config = destination.config as GmailConfig;
    await updateDestination(destination.id, { config: { ...config, email: result.email, refreshToken: result.refreshToken, connectedAt: new Date().toISOString() } });
    await setDestinationHealth(destination.id, "ok", null);
    await recordAudit(actor, "destination.gmail_connect", result.email, { id: destination.id });
    return back(request, "gmail=connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Gmail connection failed: ${message}`);
    await setDestinationHealth(destination.id, "failing", message);
    return back(request, "gmail=failed");
  }
}
