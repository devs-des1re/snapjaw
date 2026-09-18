import { jsonError, jsonOk } from "@/lib/api/response";
import { describeError, log } from "@/lib/logger";
import { runInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const RUNNER_TIMEOUT_MS = 10_000;

function runnerUrl(): string | null {
  const url = process.env.SANDBOX_RUNNER_URL?.trim().replace(/\/+$/, "");
  return url ? url : null;
}

// One line typed into a running program, handed to the sandbox that is blocked on input().
export async function POST(request: Request): Promise<Response> {
  const url = runnerUrl();
  if (!url) {
    log("error", "program input sent but SANDBOX_RUNNER_URL is not configured");
    return jsonError(
      "SERVICE_UNAVAILABLE",
      "The sandbox is not configured on this deployment.",
      undefined,
      503,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = runInputSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".");
      return field ? `${field}: ${issue.message}` : issue.message;
    });
    return jsonError("VALIDATION_ERROR", "That input could not be sent.", details);
  }

  const token = process.env.SANDBOX_RUNNER_TOKEN?.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/run/input`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(parsed.data),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      log("warn", "sandbox refused program input", { status: response.status, payload });
      return jsonError("NOT_FOUND", "The program is no longer waiting for input.");
    }

    return jsonOk({ ok: true });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    log("error", aborted ? "sandbox timed out on program input" : "sandbox unreachable", {
      error: describeError(error),
    });
    return jsonError(
      "SERVICE_UNAVAILABLE",
      aborted
        ? "The sandbox took too long to accept that input."
        : "The sandbox is unavailable right now. Try again shortly.",
    );
  } finally {
    clearTimeout(timer);
  }
}
