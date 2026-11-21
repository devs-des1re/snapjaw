import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { db, prepareDatabase } from "../db";
import { twoFactors } from "../db/schema";
import { createAdmin, findUserByEmail, isRole, setPasswordHash } from "../db/queries/users";
import { revokeAllSessions } from "../db/queries/sessions";
import { recordAudit } from "../db/queries/audit";
import { isEmail } from "../lib/address";
import { randomToken } from "../lib/crypto";
import { hashPassword, passwordProblem } from "../lib/passwords";
import type { Write } from "./index";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function choosePassword(fromStdin: boolean): Promise<{ password: string; generated: boolean }> {
  if (fromStdin) return { password: await readStdin(), generated: false };
  return { password: randomToken(18), generated: true };
}

const cliActor = { id: null, email: "cli", ip: null, userAgent: "snapjaw-cli" };

export async function adminCommand(args: string[], out: Write): Promise<number> {
  const [action, ...rest] = args;
  const { values } = parseArgs({
    args: rest,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      "password-stdin": { type: "boolean" },
    },
  });
  const email = values.email?.trim().toLowerCase() ?? "";
  if (!isEmail(email)) {
    out("Pass a valid --email.");
    return 2;
  }
  await prepareDatabase();

  if (action === "create") {
    const role = values.role ?? "owner";
    if (!isRole(role)) {
      out("--role must be owner, admin or viewer.");
      return 2;
    }
    if (await findUserByEmail(email)) {
      out(`An admin with ${email} already exists.`);
      return 1;
    }
    const { password, generated } = await choosePassword(Boolean(values["password-stdin"]));
    const problem = passwordProblem(password);
    if (problem) {
      out(problem);
      return 2;
    }
    const id = await createAdmin({ email, name: values.name ?? "", role, passwordHash: await hashPassword(password) });
    await recordAudit(cliActor, "admin.create", email, { role, id, via: "cli" });
    out(`Created ${role} ${email}.`);
    if (generated) out(`Password (shown once): ${password}`);
    return 0;
  }

  const found = await findUserByEmail(email);
  if (!found) {
    out(`No admin with ${email}.`);
    return 1;
  }

  if (action === "reset-password") {
    const { password, generated } = await choosePassword(Boolean(values["password-stdin"]));
    const problem = passwordProblem(password);
    if (problem) {
      out(problem);
      return 2;
    }
    await setPasswordHash(found.user.id, await hashPassword(password));
    await revokeAllSessions(found.user.id);
    await recordAudit(cliActor, "auth.password_reset", email, { via: "cli" });
    out(`Password reset for ${email}. Existing sessions were signed out.`);
    if (generated) out(`Password (shown once): ${password}`);
    return 0;
  }

  if (action === "reset-2fa") {
    await db.delete(twoFactors).where(eq(twoFactors.userId, found.user.id));
    await revokeAllSessions(found.user.id);
    await recordAudit(cliActor, "auth.2fa_reset", email, { via: "cli" });
    out(`Two-factor authentication removed for ${email}.`);
    return 0;
  }

  out("Unknown admin command. Use create, reset-password or reset-2fa.");
  return 2;
}
