import { auth } from "../../src/auth";
import { fail } from "../../src/api/_http";
import { isRole, type Role } from "../../db/queries/users";
import { isSameOrigin, requestInfo } from "./request";

export type Actor = {
  id: string;
  email: string | null;
  role: Role;
  ip: string | null;
  userAgent: string | null;
};

const rank: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };

export function roleAtLeast(role: Role, min: Role): boolean {
  return rank[role] >= rank[min];
}

const unsafe = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function requireRole(request: Request, min: Role, options: { allowWithout2fa?: boolean } = {}): Promise<Actor | Response> {
  if (unsafe.has(request.method) && !isSameOrigin(request)) return fail("Cross-site request blocked.", 403);
  const session = await auth.auth(request);
  if (!session?.user?.id) return fail("Sign in first.", 401);
  const role = session.user.role;
  if (!isRole(role)) return fail("Your account has no role.", 403);
  if (session.user.twoFactorSetupRequired && !options.allowWithout2fa) {
    return fail("Set up two-factor authentication before continuing.", 403);
  }
  if (!roleAtLeast(role, min)) return fail("Your role does not allow this.", 403);
  const info = requestInfo(request);
  return { id: session.user.id, email: session.user.email ?? null, role, ...info };
}
