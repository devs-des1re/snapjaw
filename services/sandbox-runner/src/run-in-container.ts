import { randomUUID } from "node:crypto";

import { DEFAULT_CAPTURE_POLICY, projectNeedsDisplay } from "./capture-display.js";
import { transportTimeoutMs, type RunnerConfig } from "./config.js";
import { DockerError, dockerExec, runDocker } from "./docker.js";
import { describeError, log as defaultLogger } from "./logger.js";

const RESULT_SENTINEL = "__SNAPJAW_RESULT__";

export interface RunRequest {
  files: Record<string, string>;
  entryFile: string;
  timeoutMs?: number;
}

export interface ContainerRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  image: string | null;
  hadDisplay: boolean;
}

interface HelperResponse {
  ok?: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  image?: string | null;
  hadDisplay?: boolean;
}

export class RunFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunFailedError";
  }
}

export function parseHelperOutput(stdout: string): HelperResponse | null {
  const index = stdout.lastIndexOf(RESULT_SENTINEL);
  if (index === -1) return null;

  const tail = stdout.slice(index + RESULT_SENTINEL.length).trim();
  if (!tail) return null;

  try {
    const parsed: unknown = JSON.parse(tail);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as HelperResponse;
  } catch {
    return null;
  }
}

/**
 * Execute a project inside one pooled container.
 *
 * The helper runs the program as a child process and reports back over a
 * single `docker exec`, so nothing the program prints can be mistaken for the
 * result payload.
 */
export async function runInContainer(
  container: string,
  request: RunRequest,
  config: RunnerConfig,
): Promise<ContainerRunResult> {
  const timeoutMs = request.timeoutMs ?? config.runTimeoutMs;
  const needsDisplay = projectNeedsDisplay(request.files);
  const runId = randomUUID().replace(/-/g, "").slice(0, 16);

  const payload = JSON.stringify({
    runId,
    files: request.files,
    entryFile: request.entryFile,
    timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    capture: needsDisplay,
    capturePolicy: {
      firstCaptureAtMs: config.firstCaptureAtMs ?? DEFAULT_CAPTURE_POLICY.firstCaptureAtMs,
      captureIntervalMs: config.captureIntervalMs ?? DEFAULT_CAPTURE_POLICY.captureIntervalMs,
    },
    screen: config.screen,
  });

  const result = await dockerExec(container, ["snapjaw-exec"], {
    input: payload,
    timeoutMs: transportTimeoutMs(config),
  });

  if (result.timedOut) {
    throw new RunFailedError(
      `the sandbox did not answer within ${transportTimeoutMs(config)}ms and was abandoned`,
    );
  }

  const parsed = parseHelperOutput(result.stdout);
  if (!parsed) {
    throw new RunFailedError(
      `unreadable sandbox response (exit ${result.code}): ${result.stderr.trim().slice(0, 300)}`,
    );
  }

  if (parsed.ok === false) {
    throw new RunFailedError(parsed.error ?? "the sandbox rejected the run");
  }

  return {
    stdout: parsed.stdout ?? "",
    stderr: parsed.stderr ?? "",
    exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : -1,
    durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : 0,
    timedOut: parsed.timedOut === true,
    image: parsed.image ? `data:image/png;base64,${parsed.image}` : null,
    hadDisplay: parsed.hadDisplay === true,
  };
}

/**
 * Return a container to a clean state.
 *
 * The container is mounted read-only, so `/tmp` is the only place a run can
 * write — which makes sweeping it a complete wipe. Orphaned helpers and stray
 * X servers are killed first, then every scratch file goes, then the work root
 * is recreated. The bracketed pkill pattern stops the reset from matching its
 * own command line.
 */
export async function resetContainer(
  container: string,
  logger: typeof defaultLogger = defaultLogger,
): Promise<boolean> {
  const script = [
    "cd /",
    "pkill -9 -f '[s]napjaw-exec' >/dev/null 2>&1",
    "pkill -9 -x Xvfb >/dev/null 2>&1",
    "find /tmp -mindepth 1 -maxdepth 1 -exec rm -rf {} + >/dev/null 2>&1",
    "mkdir -p /tmp/snapjaw-work",
    "true",
  ].join("; ");

  try {
    const result = await dockerExec(container, ["sh", "-c", script], { timeoutMs: 20_000 });
    if (result.code !== 0) {
      logger("warn", "container reset reported a non-zero exit", {
        container,
        code: result.code,
        stderr: result.stderr.trim().slice(0, 200),
      });
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof DockerError) {
      logger("warn", "container reset failed", { container, error: describeError(error) });
      return false;
    }
    throw error;
  }
}

/** Confirm a container can still start a process. */
export async function containerAnswers(container: string): Promise<boolean> {
  try {
    const result = await runDocker(["exec", container, "true"], { timeoutMs: 10_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}
