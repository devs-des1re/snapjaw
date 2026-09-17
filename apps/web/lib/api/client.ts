import type { ApiErrorBody } from "@/lib/api/response";

// Pulls a human-readable message out of an unknown JSON payload.
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

export function readSharedUrl(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const { url } = payload as { url?: unknown };
  return typeof url === "string" && url.length > 0 ? url : null;
}
