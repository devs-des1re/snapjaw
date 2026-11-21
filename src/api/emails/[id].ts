import { resendCompat, resendCompatError } from "../_http";
import { authenticateApiKey } from "../../../server/credentials/service";
import { emailForCompat } from "../../../server/compat/emails";

export async function GET(request: Request, context: { params: { id: string } }) {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key) return resendCompatError(401, "missing_api_key", "Missing or invalid Snapjaw API key.");
  const email = await emailForCompat(context.params.id);
  if (!email) return resendCompatError(404, "not_found", "Email not found.");
  return resendCompat(email);
}
