import { auth } from "./src/auth";
import { countUsers } from "./db/queries/users";
import { prepareDatabase } from "./db";

const securityHeaders: Record<string, string> = {
  "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
};

const publicPages = ["/login", "/setup", "/invite"];

const store = globalThis as typeof globalThis & { __snapjawHasUsers?: boolean };

async function hasUsers(): Promise<boolean> {
  if (store.__snapjawHasUsers) return true;
  await prepareDatabase();
  const present = (await countUsers()) > 0;
  if (present) store.__snapjawHasUsers = true;
  return present;
}

function pass(extra: Record<string, string> = {}): Response {
  return new Response(null, { headers: { "x-middleware-next": "1", ...securityHeaders, ...extra } });
}

function redirect(request: Request, location: string): Response {
  return new Response(null, { status: 303, headers: { location: new URL(location, request.url).toString(), ...securityHeaders } });
}

function isPublicPage(pathname: string): boolean {
  return publicPages.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path.startsWith("/api/")) return pass({ "cache-control": "no-store" });
  if (/\.[a-z0-9]+$/i.test(path) || path.startsWith("/_krate") || path === "/healthz" || path === "/readyz" || path === "/metrics") return pass();

  if (!(await hasUsers())) {
    return path === "/setup" ? pass() : redirect(request, "/setup");
  }
  if (path === "/setup") return redirect(request, "/login");
  if (isPublicPage(path)) return pass();

  const session = await auth.auth(request);
  if (!session?.user?.id) {
    const next = encodeURIComponent(url.pathname + url.search);
    return redirect(request, `/login?callbackUrl=${next}`);
  }
  if (session.user.twoFactorSetupRequired && path !== "/account") {
    return redirect(request, "/account?setup=2fa");
  }
  return pass({ "cache-control": "no-store" });
}
