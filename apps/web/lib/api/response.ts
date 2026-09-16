import { APP_VERSION } from "@/lib/version";

/**
 * One error shape and one success shape for the whole API.
 *
 * Success: { ...payload, timestamp, version }
 * Failure: { error: { code, message, details? }, timestamp, version }
 */

export type ApiErrorCode =
  "BAD_REQUEST" | "VALIDATION_ERROR" | "NOT_FOUND" | "PAYLOAD_TOO_LARGE" | "INTERNAL_ERROR";

const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};

export interface ApiMeta {
  timestamp: string;
  version: string;
}

export function apiMeta(): ApiMeta {
  return { timestamp: new Date().toISOString(), version: APP_VERSION };
}

export function jsonOk<T extends Record<string, unknown>>(payload: T, status = 200): Response {
  return Response.json({ ...payload, ...apiMeta() }, { status });
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: string[];
  };
  timestamp: string;
  version: string;
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  details?: string[],
  status = STATUS_FOR_CODE[code],
): Response {
  const body: ApiErrorBody = {
    error: { code, message, ...(details && details.length > 0 ? { details } : {}) },
    ...apiMeta(),
  };
  return Response.json(body, { status });
}
