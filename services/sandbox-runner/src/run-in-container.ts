import { randomUUID } from "node:crypto";

import { DEFAULT_CAPTURE_POLICY, projectNeedsDisplay } from "./capture-display.js";
import { transportTimeoutMs, type RunnerConfig } from "./config.js";
import { DockerError, dockerExec, runDocker, runDockerStreaming } from "./docker.js";
import { describeError, log as defaultLogger } from "./logger.js";

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
  frameCount: number;
}

/** One captured display frame, base64 PNG, as it was drawn. */
export interface LiveFrame {
  seq: number;
  atMs: number;
  png: string;
}

interface HelperResultEvent {
  type: "result";
  ok?: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  image?: string | null;
  hadDisplay?: boolean;
  frameCount?: number;
}

interface HelperFrameEvent {
  type: "frame";
  seq?: number;
  atMs?: number;
  png?: string;
}

export type HelperEvent = HelperResultEvent | HelperFrameEvent;

export class RunFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunFailedError";
  }
}

/**
 * Parse one NDJSON line from the helper.
 *
 * Anything that is not a recognisable event is ignored rather than treated as
 * a failure: a stray line must not lose a run whose result is still coming.
 */
export function parseHelperLine(line: string): HelperEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const { type } = parsed as { type?: unknown };
  if (type === "frame" || type === "result") return parsed as HelperEvent;
  return null;
}

function toLiveFrame(event: HelperFrameEvent): LiveFrame | null {
  if (typeof event.png !== "string" || event.png.length === 0) return null;
  return {
    seq: typeof event.seq === "number" ? event.seq : 0,
    atMs: typeof event.atMs === "number" ? event.atMs : 0,
    png: event.png,
  };
}

export interface RunOptions {
  /** Called for each captured display frame, as it is drawn. */
  onFrame?: (frame: LiveFrame) => void;
  /** Abort the run, e.g. because the browser went away. */
  signal?: AbortSignal;
}

/**
 * Execute a project inside one pooled container.
 *
 * The helper runs the program as a child process and reports back over a
 * single `docker exec`, so nothing the program prints can be mistaken for the
 * event stream. Frames arrive while the program is still running.
 */
export async function runInContainer(
  container: string,
  request: RunRequest,
  config: RunnerConfig,
  options: RunOptions = {},
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
      stableFramesRequired: config.stableFramesRequired,
    },
    screen: config.screen,
  });

  // Collected in an array rather than a `let`: assignments made inside the
  // stream callback are invisible to control-flow analysis, so a `let` would
  // be narrowed to `null` for everything after the await.
  const results: HelperResultEvent[] = [];

  const transport = await runDockerStreaming(["exec", "-i", container, "snapjaw-exec"], {
    input: payload,
    timeoutMs: transportTimeoutMs(config),
    signal: options.signal,
    onStdoutLine: (line) => {
      const event = parseHelperLine(line);
      if (!event) return;

      if (event.type === "frame") {
        const frame = toLiveFrame(event);
        if (frame && options.onFrame) options.onFrame(frame);
        return;
      }

      results.push(event);
    },
  });

  if (transport.timedOut) {
    throw new RunFailedError(
      `the sandbox did not answer within ${transportTimeoutMs(config)}ms and was abandoned`,
    );
  }

  const resultEvent = results.at(-1);
  if (!resultEvent) {
    throw new RunFailedError(
      `unreadable sandbox response (exit ${transport.code}): ${transport.stderr.trim().slice(0, 300)}`,
    );
  }

  if (resultEvent.ok === false) {
    throw new RunFailedError(resultEvent.error ?? "the sandbox rejected the run");
  }

  return {
    stdout: resultEvent.stdout ?? "",
    stderr: resultEvent.stderr ?? "",
    exitCode: typeof resultEvent.exitCode === "number" ? resultEvent.exitCode : -1,
    durationMs: typeof resultEvent.durationMs === "number" ? resultEvent.durationMs : 0,
    timedOut: resultEvent.timedOut === true,
    image: resultEvent.image ? `data:image/png;base64,${resultEvent.image}` : null,
    hadDisplay: resultEvent.hadDisplay === true,
    frameCount: typeof resultEvent.frameCount === "number" ? resultEvent.frameCount : 0,
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
