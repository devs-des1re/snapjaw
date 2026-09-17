// Prefers APP_URL because behind a proxy the request's own origin is internal.
export function shareUrlFor(
  request: Request,
  id: string,
  appUrl: string | undefined = process.env.APP_URL,
): string {
  const configured = appUrl?.trim().replace(/\/+$/, "");
  if (configured) return `${configured}/file/${id}`;

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}/file/${id}`;
  }

  return new URL(`/file/${id}`, request.url).toString();
}
