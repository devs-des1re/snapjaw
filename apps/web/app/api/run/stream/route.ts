import { jsonError } from "@/lib/api/response";
import { describeError, log } from "@/lib/logger";
import { checkRunRateLimit, clientIdentifier } from "@/lib/ratelimit";
import { runRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

// Silence, not elapsed time, is the failure signal: a run can sit on input() while somebody types.
const RUNNER_IDLE_MS = 60_000;
const RUNNER_MAX_MS = 11 * 60_000;

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

// Newline-delimited JSON: frame events while the window is drawn, then one result or error.
export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();

  const identifier = clientIdentifier(request);
  const limit = await checkRunRateLimit(identifier);
  if (!limit.allowed) {
    log("warn", "streamed run rejected by rate limit", { identifier });
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
    log("error", "streamed run requested but SANDBOX_RUNNER_URL is not configured");
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
  const timeoutController = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => timeoutController.abort(), RUNNER_IDLE_MS);
  };

  armIdle();
  const maxTimer = setTimeout(() => timeoutController.abort(), RUNNER_MAX_MS);

  // Abandon the runner request if the browser goes away, so the sandbox stops drawing.
  const onClientAbort = () => timeoutController.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(`${url}/run/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(parsed.data),
      signal: timeoutController.signal,
      cache: "no-store",
    });
  } catch (error) {
    clearTimeout(idleTimer ?? undefined);
    clearTimeout(maxTimer);
    request.signal.removeEventListener("abort", onClientAbort);

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
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(idleTimer ?? undefined);
    clearTimeout(maxTimer);
    request.signal.removeEventListener("abort", onClientAbort);

    const payload: unknown = await upstream.json().catch(() => null);
    const message = runnerErrorMessage(payload);
    log("error", "sandbox runner refused the streamed run", {
      status: upstream.status,
      message,
      wallMs: Date.now() - startedAt,
    });
    return jsonError(
      upstream.status === 503 ? "SERVICE_UNAVAILABLE" : "BAD_GATEWAY",
      message ?? "The sandbox could not run that code.",
    );
  }

  log("info", "streaming run started", {
    entryFile: parsed.data.entryFile,
    identifier,
    rateLimited: limit.enforced,
  });

  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    request.signal.removeEventListener("abort", onClientAbort);
  };

  // Relayed by hand so a browser cancel tears the runner request down too.
  const reader = upstream.body.getReader();
  const relay = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          cleanup();
          return;
        }
        // Every frame, line of output and heartbeat is proof the sandbox is still working.
        armIdle();
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        cleanup();
      }
    },
    cancel() {
      timeoutController.abort();
      void reader.cancel().catch(() => {});
      cleanup();
    },
  });

  return new Response(relay, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
