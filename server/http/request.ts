import { AsyncLocalStorage } from "node:async_hooks";

export type RequestInfo = { ip: string | null; userAgent: string | null };

const store = globalThis as typeof globalThis & { __snapjawRequestStore?: AsyncLocalStorage<RequestInfo> };

function storage() {
  store.__snapjawRequestStore ??= new AsyncLocalStorage<RequestInfo>();
  return store.__snapjawRequestStore;
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}

export function requestInfo(request: Request): RequestInfo {
  return { ip: clientIp(request), userAgent: request.headers.get("user-agent") };
}

export function withRequest<T>(request: Request, fn: () => T): T {
  return storage().run(requestInfo(request), fn);
}

export function currentRequest(): RequestInfo {
  return storage().getStore() ?? { ip: null, userAgent: null };
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  if (!origin) return site === "same-origin" || site === "none";
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 1024 * 1024): Promise<T | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}
