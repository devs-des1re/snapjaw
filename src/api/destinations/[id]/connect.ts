import { createHash } from "node:crypto";
import { fail, ok } from "../../_http";
import { requireRole } from "../../../../server/http/guard";
import { getDestination, type GmailConfig } from "../../../../db/queries/destinations";
import { authUrl } from "../../../../server/destinations/gmail";
import { db } from "../../../../db";
import { oauthStates } from "../../../../db/schema";
import { randomToken } from "../../../../lib/crypto";

export async function POST(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const destination = await getDestination(context.params.id);
  if (!destination || destination.type !== "gmail") return fail("No such Gmail destination.", 404);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await db.insert(oauthStates).values({ state, destinationId: destination.id, verifier, createdBy: actor.id, expiresAt: new Date(Date.now() + 10 * 60_000) });
  try {
    return ok({ url: await authUrl(state, challenge, (destination.config as GmailConfig).email || undefined) });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 422);
  }
}
