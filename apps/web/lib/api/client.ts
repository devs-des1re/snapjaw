import type { ApiErrorBody } from "@/lib/api/response";

/** Narrow an unknown JSON payload to our error envelope. */
export function readApiError(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const { error } = payload as Partial<ApiErrorBody>;
  if (typeof error !== "object" || error === null) return null;

  const { message, details } = error;
  if (typeof message !== "string") return null;

  if (Array.isArray(details) && details.length > 0) {
    return `${message} ${details.join(" ")}`;
  }
  return message;
}

/** Narrow an unknown JSON payload to the share URL we expect back. */
export function readSharedUrl(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const { url } = payload as { url?: unknown };
  return typeof url === "string" && url.length > 0 ? url : null;
}
