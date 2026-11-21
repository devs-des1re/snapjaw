import QRCode from "qrcode";
import { fail, ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { readJson } from "../../../server/http/request";

export async function POST(request: Request) {
  const actor = await requireRole(request, "viewer", { allowWithout2fa: true });
  if (actor instanceof Response) return actor;
  const body = await readJson<{ text?: unknown }>(request, 4096);
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.startsWith("otpauth://")) return fail("Only authenticator links can be encoded.", 422);
  const code = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = code.modules.size;
  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (code.modules.get(x, y)) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return ok({ size, path: parts.join("") });
}
