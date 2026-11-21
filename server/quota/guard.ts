import { addUsage, currentUsage, markAlerted } from "../../db/queries/usage";
import { getNumberSetting, getSetting } from "../../db/queries/settings";
import { logger } from "../../lib/logger";
import { notify } from "../ops/alerts";

export type QuotaDecision = { allowed: true } | { allowed: false; mode: "hold" | "reject"; reason: string };

export type QuotaStatus = {
  day: number;
  month: number;
  dailyLimit: number;
  monthlyLimit: number;
  alertPercent: number;
  mode: "hold" | "reject";
};

export async function quotaStatus(): Promise<QuotaStatus> {
  const [snapshot, dailyLimit, monthlyLimit, alertPercent, mode] = await Promise.all([
    currentUsage(),
    getNumberSetting("quota.daily"),
    getNumberSetting("quota.monthly"),
    getNumberSetting("quota.alertPercent"),
    getSetting("quota.mode"),
  ]);
  return { day: snapshot.day, month: snapshot.month, dailyLimit, monthlyLimit, alertPercent, mode: mode === "reject" ? "reject" : "hold" };
}

export function evaluate(status: QuotaStatus, units: number): QuotaDecision {
  if (status.dailyLimit > 0 && status.day + units > status.dailyLimit) {
    return { allowed: false, mode: status.mode, reason: `The daily Resend quota of ${status.dailyLimit} would be exceeded (${status.day} used).` };
  }
  if (status.monthlyLimit > 0 && status.month + units > status.monthlyLimit) {
    return { allowed: false, mode: status.mode, reason: `The monthly Resend quota of ${status.monthlyLimit} would be exceeded (${status.month} used).` };
  }
  return { allowed: true };
}

export async function checkQuota(units: number): Promise<QuotaDecision> {
  return evaluate(await quotaStatus(), units);
}

export async function consume(kind: "sent" | "received", units: number) {
  await addUsage(kind, units);
  await maybeAlert();
}

async function maybeAlert() {
  const status = await quotaStatus();
  const { dayRow } = await currentUsage();
  if (dayRow?.alertedAt) return;
  const dayRatio = status.dailyLimit > 0 ? status.day / status.dailyLimit : 0;
  const monthRatio = status.monthlyLimit > 0 ? status.month / status.monthlyLimit : 0;
  const ratio = Math.max(dayRatio, monthRatio);
  if (ratio * 100 < status.alertPercent) return;
  await markAlerted();
  const text = `Resend quota at ${Math.round(ratio * 100)}%: ${status.day}/${status.dailyLimit || "unlimited"} today, ${status.month}/${status.monthlyLimit || "unlimited"} this month.`;
  logger.warn(text);
  await notify("Resend quota warning", text);
}
