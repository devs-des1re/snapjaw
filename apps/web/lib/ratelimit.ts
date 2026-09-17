import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { log } from "@/lib/logger";

// Fails open when Upstash is unconfigured, so local development needs no Redis.

export interface RateLimitOutcome {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  enforced: boolean;
}

type Limiter = Ratelimit;

const DEFAULTS = { limit: 10, window: "1 m" } as const;

function readLimit(): number {
  const raw = process.env.RUN_RATE_LIMIT?.trim();
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : DEFAULTS.limit;
}

function readWindow(): string {
  return process.env.RUN_RATE_WINDOW?.trim() || DEFAULTS.window;
}

let cached: Limiter | null | undefined;

function getLimiter(): Limiter | null {
  if (cached !== undefined) return cached;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    log("warn", "run rate limiting is disabled: Upstash credentials are not configured", {
      hint: "set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
    });
    cached = null;
    return cached;
  }

  const limit = readLimit();
  const window = readWindow();

  cached = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(
      limit,
      window as Parameters<typeof Ratelimit.slidingWindow>[1],
    ),
    prefix: "snapjaw:run",
    analytics: false,
  });

  log("info", "run rate limiting enabled", { limit, window });
  return cached;
}

export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "anonymous";
}

export async function checkRunRateLimit(identifier: string): Promise<RateLimitOutcome> {
  const limiter = getLimiter();
  const limit = readLimit();

  if (!limiter) {
    return { allowed: true, limit, remaining: limit, retryAfterSeconds: 0, enforced: false };
  }

  try {
    const result = await limiter.limit(identifier);
    return {
      allowed: result.success,
      limit: result.limit,
      remaining: result.remaining,
      retryAfterSeconds: Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
      enforced: true,
    };
  } catch (error) {
    // A Redis outage must not take the editor down with it.
    log("error", "rate limit check failed, allowing the run", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { allowed: true, limit, remaining: limit, retryAfterSeconds: 0, enforced: false };
  }
}
