import { jsonError, jsonOk } from "@/lib/api/response";
import { describeError, log } from "@/lib/logger";
import { checkRunRateLimit, clientIdentifier } from "@/lib/ratelimit";
import { runRequestSchema, runnerRunResultSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

// Outer bound on the hop to the runner; the runner bounds the program itself.
const RUNNER_TIMEOUT_MS = 30_000;

// Checked before parsing so an oversized body is rejected without buffering it.
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

function runnerUrl(): string | null {
  const url = process.env.SANDBOX_RUNNER_URL?.trim().replace(/\/+$/, "");
  return url ? url : null;
}

function runnerErrorMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { error } = payload as { error?: unknown };
  return typeof error === "string" && error.length > 0 ? error : null;
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();

  // Rate limited before parsing so a flood is cheap to reject.
  const identifier = clientIdentifier(request);
  const limit = await checkRunRateLimit(identifier);
  if (!limit.allowed) {
    log("warn", "run rejected by rate limit", {
      identifier,
      limit: limit.limit,
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    return jsonError(
      "RATE_LIMITED",
      "Too many runs in a row. Wait a moment and try again.",
      undefined,
      429,
      {
        "retry-after": String(limit.retryAfterSeconds),
        "x-ratelimit-limit": String(limit.limit),
        "x-ratelimit-remaining": String(limit.remaining),
      },
    );
  }

  const url = runnerUrl();
  if (!url) {
    log("error", "run requested but SANDBOX_RUNNER_URL is not configured");
    return jsonError(
      "SERVICE_UNAVAILABLE",
      "The sandbox is not configured on this deployment.",
      undefined,
      503,
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonError("PAYLOAD_TOO_LARGE", "That request body is too large.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".");
      return field ? `${field}: ${issue.message}` : issue.message;
    });
    return jsonError("VALIDATION_ERROR", "That code could not be run.", details);
  }

  const token = process.env.SANDBOX_RUNNER_TOKEN?.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(parsed.data),
      signal: controller.signal,
      cache: "no-store",
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message = runnerErrorMessage(payload);
      log("error", "sandbox runner refused the run", {
        status: response.status,
        message,
        wallMs: Date.now() - startedAt,
      });
      return jsonError(
        response.status === 503 ? "SERVICE_UNAVAILABLE" : "BAD_GATEWAY",
        message ?? "The sandbox could not run that code.",
      );
    }

    const result = runnerRunResultSchema.safeParse(payload);
    if (!result.success) {
      log("error", "sandbox runner returned an unexpected payload", {
        error: result.error.issues.map((issue) => issue.message).join("; "),
      });
      return jsonError("BAD_GATEWAY", "The sandbox returned an unexpected response.");
    }

    log("info", "run completed", {
      entryFile: result.data.entryFile,
      exitCode: result.data.exitCode,
      timedOut: result.data.timedOut,
      programMs: result.data.durationMs,
      wallMs: Date.now() - startedAt,
      captured: result.data.image !== null,
      rateLimited: limit.enforced,
    });

    const { hadDisplay: _hadDisplay, ...result_ } = result.data;
    return jsonOk(result_);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    log("error", aborted ? "sandbox runner timed out" : "sandbox runner unreachable", {
      error: describeError(error),
      wallMs: Date.now() - startedAt,
    });
    return jsonError(
      "SERVICE_UNAVAILABLE",
      aborted
        ? "The sandbox took too long to answer. Try running again."
        : "The sandbox is unavailable right now. Try again shortly.",
    );
  } finally {
    clearTimeout(timer);
  }
}
