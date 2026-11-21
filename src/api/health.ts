import { ok } from "./_http";

export function GET() {
  return ok({ status: "ok", uptime: process.uptime() });
}
