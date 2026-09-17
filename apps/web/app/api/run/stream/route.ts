import { jsonError } from "@/lib/api/response";
import { describeError, log } from "@/lib/logger";
import { checkRunRateLimit, clientIdentifier } from "@/lib/ratelimit";
import { runRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Outer bound on the hop to the runner; the runner bounds the program itself. */
const RUNNER_TIMEOUT_MS = 60_000;

/** Hard cap on the raw request body, before it is parsed into memory. */
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

/**
 * POST /api/run/stream — execute a project and relay its output live.
 *
 * The response is newline-delimited JSON: `frame` events while a turtle or
 * tkinter window is being drawn, then one `result` or `error` event. The web
 * process still never runs user code; it pipes the runner's stream straight
 * through.
 */
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
  const timer = setTimeout(() => timeoutController.abort(), RUNNER_TIMEOUT_MS);

  // Tear the runner request down if the browser goes away, otherwise the
  // sandbox would keep drawing for nobody.
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
    clearTimeout(timer);
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
    clearTimeout(timer);
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
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onClientAbort);
  };

  // Relay by hand rather than piping, so cancelling the browser side tears the
  // runner request down instead of leaving the sandbox drawing for nobody.
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
