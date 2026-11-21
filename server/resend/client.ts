import pkg from "../../package.json" with { type: "json" };
import { getNumberSetting, getSetting } from "../../db/queries/settings";
import { recordResendQuota } from "../../db/queries/usage";
import { env } from "../../lib/env";
import { TokenBucket } from "./bucket";

export class ResendError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ResendError";
  }

  get retryable(): boolean {
    if (this.status === 0 || this.status >= 500) return true;
    return this.code === "rate_limit_exceeded" || this.code === "concurrent_idempotent_requests";
  }

  get quota(): boolean {
    return this.code === "daily_quota_exceeded" || this.code === "monthly_quota_exceeded";
  }
}

const store = globalThis as typeof globalThis & { __snapjawResendBucket?: TokenBucket };

async function bucket(): Promise<TokenBucket> {
  const rate = Math.max(1, await getNumberSetting("resend.rateLimit"));
  if (!store.__snapjawResendBucket || store.__snapjawResendBucket.rate !== rate) store.__snapjawResendBucket = new TokenBucket(rate, rate);
  return store.__snapjawResendBucket;
}

export type RequestOptions = { method?: string; body?: unknown; idempotencyKey?: string; apiKey?: string; signal?: AbortSignal };

export async function resendRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const apiKey = options.apiKey ?? (await getSetting("resend.apiKey"));
  if (!apiKey) throw new ResendError(401, "missing_api_key", "No Resend API key is set. Add one under Settings.");
  await (await bucket()).take();
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "user-agent": `snapjaw/${pkg.version}`,
    accept: "application/json",
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`${env().resendBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ?? AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new ResendError(0, "network_error", `Could not reach Resend: ${error instanceof Error ? error.message : String(error)}`);
  }
  const daily = Number(response.headers.get("x-resend-daily-quota"));
  const monthly = Number(response.headers.get("x-resend-monthly-quota"));
  if (Number.isFinite(daily) || Number.isFinite(monthly)) {
    await recordResendQuota(Number.isFinite(daily) && response.headers.has("x-resend-daily-quota") ? daily : null, Number.isFinite(monthly) && response.headers.has("x-resend-monthly-quota") ? monthly : null);
  }
  const text = await response.text();
  const json = text ? safeJson(text) : null;
  if (!response.ok) {
    const body = (json ?? {}) as { name?: string; message?: string; error?: string };
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ResendError(response.status, body.name ?? statusCode(response.status), body.message ?? body.error ?? `Resend answered ${response.status}.`, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  return json as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function statusCode(status: number): string {
  if (status === 401) return "missing_api_key";
  if (status === 403) return "invalid_api_key";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit_exceeded";
  if (status >= 500) return "application_error";
  return "validation_error";
}

export async function downloadUrl(url: string, maxBytes: number): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new ResendError(response.status, "download_failed", `Download from Resend storage failed with ${response.status}.`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new ResendError(413, "too_large", `The message is ${length} bytes, over the ${maxBytes} byte limit.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new ResendError(413, "too_large", `The message is ${buffer.length} bytes, over the ${maxBytes} byte limit.`);
  return buffer;
}

export function explainResendError(error: unknown): { message: string; fix: string } {
  if (!(error instanceof ResendError)) return { message: error instanceof Error ? error.message : String(error), fix: "Check the Snapjaw logs for details." };
  const fixes: Record<string, string> = {
    missing_api_key: "Add a Resend API key under Settings.",
    invalid_api_key: "The Resend API key is wrong or was deleted. Create a new one in Resend and save it under Settings.",
    restricted_api_key: "The key can only send. Use a full access key so Snapjaw can manage domains and read received mail.",
    validation_error: "Resend rejected the message. Check the sender domain is verified and the addresses are valid.",
    invalid_from_address: "The From address must use a domain verified in Resend.",
    daily_quota_exceeded: "The Resend daily quota is used up. Mail is held and retried after midnight UTC.",
    monthly_quota_exceeded: "The Resend monthly quota is used up. Upgrade the plan or wait for the next cycle.",
    rate_limit_exceeded: "Too many requests per second. Snapjaw retries automatically. Lower the rate limit under Settings if this repeats.",
    network_error: "Snapjaw could not reach api.resend.com. Check DNS and outbound internet access.",
    not_found: "Resend does not know this object. It may have been deleted in the Resend dashboard.",
    application_error: "Resend had an internal error. Snapjaw retries automatically.",
    too_large: "Raise the message size limit under Settings, or ask the sender for a smaller message.",
  };
  return { message: error.message, fix: fixes[error.code] ?? "See the error message above, then retry." };
}
