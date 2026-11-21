import { resendCompat, resendCompatError } from "../_http";
import { authenticateApiKey } from "../../../server/credentials/service";
import { sendFromJson } from "../../../server/compat/emails";
import { readJson } from "../../../server/http/request";

const codes: Record<number, string> = { 400: "validation_error", 403: "invalid_from_address", 409: "invalid_idempotent_request", 413: "validation_error", 422: "validation_error", 429: "rate_limit_exceeded", 508: "validation_error" };

export async function POST(request: Request) {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key) return resendCompatError(401, "missing_api_key", "Missing or invalid Snapjaw API key. Use Authorization: Bearer sj_...");
  const body = await readJson<Record<string, unknown>>(request, 40 * 1024 * 1024);
  if (!body) return resendCompatError(422, "validation_error", "The body must be JSON with Content-Type: application/json.");
  const result = await sendFromJson({ id: key.id, kind: "api", allowedSenders: key.allowedSenders, ratePerHour: key.ratePerHour }, body, request.headers.get("idempotency-key"));
  if (!result.ok) return resendCompatError(result.httpStatus, codes[result.httpStatus] ?? "validation_error", result.message);
  return resendCompat({ id: result.id });
}
