import { credentials, defineAuth, type Adapter, type AdapterSession } from "@krate/auth";
import { DrizzleAdapter } from "@krate/auth/drizzle";
import { db } from "../db";
import { accounts, authenticators, sessions, twoFactors, users, verificationTokens } from "../db/schema";
import { findUserByEmail, findUserById, recordLogin } from "../db/queries/users";
import { recordSessionMeta } from "../db/queries/sessions";
import { recordAudit } from "../db/queries/audit";
import { getBooleanSetting } from "../db/queries/settings";
import { deriveKey } from "../lib/crypto";
import { verifyPassword } from "../lib/passwords";
import { logger } from "../lib/logger";
import { currentRequest } from "../server/http/request";

function buildAdapter(): Adapter {
  const base = DrizzleAdapter(db, { users, accounts, sessions, verificationTokens, authenticators, twoFactors });
  return {
    ...base,
    async createSession(session: AdapterSession) {
      const created = await base.createSession!(session);
      const info = currentRequest();
      await recordSessionMeta({ sessionToken: session.sessionToken, userId: session.userId, userAgent: info.userAgent, ip: info.ip });
      return created;
    },
  };
}

export const auth = defineAuth(() => ({
  secret: deriveKey("auth-secret").toString("base64"),
  adapter: buildAdapter(),
  trustHost: true,
  session: { strategy: "database", maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  pages: { signIn: "/login", twoFactor: "/login/2fa", error: "/login" },
  cookies: { prefix: "snapjaw", sameSite: "lax" },
  twoFactor: { enabled: true, issuer: "Snapjaw", backupCodes: 10 },
  rateLimit: { enabled: true, max: 10, window: 300 },
  redirects: { signedIn: "/", signedOut: "/login" },
  logger: {
    debug: () => undefined,
    warn: (code: string) => logger.warn(`auth: ${code}`),
    error: (code: string) => logger.error(`auth: ${code}`),
  },
  providers: [
    credentials({
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(input) {
        const email = String(input.email ?? "").trim().toLowerCase();
        const password = String(input.password ?? "");
        if (!email || !password || password.length > 256) return null;
        const found = await findUserByEmail(email);
        const valid = await verifyPassword(password, found?.profile?.passwordHash);
        if (!found || !valid) {
          await recordAudit({ email, ...currentRequest() }, "auth.login_failed", email);
          return null;
        }
        if (found.profile?.disabledAt) {
          await recordAudit({ id: found.user.id, email, ...currentRequest() }, "auth.login_blocked", email, { reason: "disabled" });
          return null;
        }
        return { id: found.user.id, email: found.user.email, name: found.user.name, role: found.user.role };
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.id) return false;
      const found = await findUserById(String(user.id));
      return Boolean(found && !found.profile?.disabledAt);
    },
    async session({ session, user }) {
      const enforce = await getBooleanSetting("security.require2fa");
      return {
        ...session,
        user: {
          ...session.user,
          role: user?.role ?? session.user.role ?? null,
          twoFactorEnabled: Boolean(user?.twoFactorEnabled),
          twoFactorSetupRequired: enforce && !user?.twoFactorEnabled,
        },
      };
    },
  },
  events: {
    async signIn({ user }) {
      const info = currentRequest();
      if (user.id) await recordLogin(String(user.id), info.ip);
      await recordAudit({ id: String(user.id ?? ""), email: user.email ?? null, ...info }, "auth.login", user.email ?? null);
    },
    async signOut({ session }) {
      await recordAudit({ id: session?.user.id, email: session?.user.email ?? null, ...currentRequest() }, "auth.logout", session?.user.email ?? null);
    },
    async twoFactorEnabled({ user }) {
      await recordAudit({ id: String(user.id ?? ""), email: user.email ?? null, ...currentRequest() }, "auth.2fa_enabled", user.email ?? null);
    },
    async twoFactorDisabled({ user }) {
      await recordAudit({ id: String(user.id ?? ""), email: user.email ?? null, ...currentRequest() }, "auth.2fa_disabled", user.email ?? null);
    },
  },
}));
