import { prepareDatabase } from "../db";
import { runDoctor } from "../server/ops/doctor";
import type { Write } from "./index";

export async function doctorCommand(out: Write): Promise<number> {
  await prepareDatabase();
  const checks = await runDoctor();
  let failed = 0;
  for (const check of checks) {
    const mark = check.status === "ok" ? "ok  " : check.status === "warn" ? "warn" : "FAIL";
    if (check.status === "fail") failed += 1;
    out(`[${mark}] ${check.name}: ${check.detail}`);
    if (check.fix && check.status !== "ok") out(`       fix: ${check.fix}`);
  }
  out(failed ? `${failed} check(s) failed.` : "All checks passed.");
  return failed ? 1 : 0;
}
