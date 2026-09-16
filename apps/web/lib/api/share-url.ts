/**
 * Build the public link for a share.
 *
 * Behind Traefik the request URL is the internal address, so prefer the
 * configured public origin, then the forwarded headers, and only fall back to
 * the request origin for local development.
 *
 * `APP_URL` is deliberately not `NEXT_PUBLIC_*`: that prefix is inlined into
 * the bundle at build time, which would bake one environment's URL into every
 * deployment.
 *
 * `appUrl` is injectable so the fallback chain is testable without touching
 * the environment.
 */
export function shareUrlFor(
  request: Request,
  id: string,
  appUrl: string | undefined = process.env.APP_URL,
): string {
  const configured = appUrl?.trim().replace(/\/+$/, "");
  if (configured) return `${configured}/s/${id}`;

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}/s/${id}`;
  }

  return new URL(`/s/${id}`, request.url).toString();
}
