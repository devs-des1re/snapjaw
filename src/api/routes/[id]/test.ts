import { fail, ok } from "../../_http";
import { requireRole } from "../../../../server/http/guard";
import { getRoute } from "../../../../db/queries/destinations";
import { verifiedDomainNames } from "../../../../db/queries/domains";
import { getSetting } from "../../../../db/queries/settings";
import { readJson } from "../../../../server/http/request";
import { recordAudit } from "../../../../db/queries/audit";
import { sendEmail } from "../../../../server/resend/api";
import { explainResendError } from "../../../../server/resend/client";
import { consume } from "../../../../server/quota/guard";
import { isEmail } from "../../../../lib/address";
import { randomToken } from "../../../../lib/crypto";

export async function POST(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const route = await getRoute(context.params.id);
  if (!route) return fail("No such route.", 404);
  const body = await readJson<{ from?: unknown }>(request);
  const to = route.kind === "address" ? route.pattern : route.pattern.replace("*", "test");
  const verified = await verifiedDomainNames();
  const from = typeof body?.from === "string" && isEmail(body.from) ? body.from : (await getSetting("alerts.from")).replace(/^.*<([^>]+)>$/, "$1");
  if (!from || !isEmail(from)) return fail("Enter a sender address on a verified domain to send the test from.", 422);
  if (!verified.includes(from.split("@")[1]!.toLowerCase())) return fail(`${from} is not on a verified domain.`, 422);
  const token = randomToken(6);
  try {
    const result = await sendEmail(
      {
        from: `Snapjaw test <${from}>`,
        to: [to],
        subject: `Snapjaw route test ${token}`,
        text: `This is a test sent by Snapjaw to check the route for ${route.pattern}.\nIf it arrives in the destination mailbox, the route works.\n`,
      },
      `snapjaw-route-test-${route.id}-${token}`,
    );
    await consume("sent", 1);
    await recordAudit(actor, "route.test", route.pattern, { to, resendId: result.id });
    return ok({ to, resendId: result.id, note: "Sent. It counts as one sent and one received email against the Resend quota." });
  } catch (error) {
    const explained = explainResendError(error);
    return fail(`${explained.message} ${explained.fix}`, 422);
  }
}
