import { randomUUID } from "node:crypto";

import { DEFAULT_CAPTURE_POLICY, projectNeedsDisplay } from "./capture-display.js";
import { transportTimeoutMs, type RunnerConfig } from "./config.js";
import { DockerError, dockerExec, runDocker, runDockerStreaming } from "./docker.js";
import { describeError, log as defaultLogger } from "./logger.js";
import type { RunRegistry } from "./run-registry.js";

export interface RunRequest {
  files: Record<string, string>;
  entryFile: string;
  timeoutMs?: number;
  runId?: string;
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

export interface LiveFrame {
  seq: number;
  atMs: number;
  format: string;
  data: string;
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
  format?: string;
  data?: string;
}

interface HelperInputEvent {
  type: "input";
  prompt?: string;
}

interface HelperOutputEvent {
  type: "output";
  stream?: string;
  text?: string;
}

interface HelperWaitingEvent {
  type: "waiting";
}

export type HelperEvent =
  HelperResultEvent | HelperFrameEvent | HelperInputEvent | HelperOutputEvent | HelperWaitingEvent;

export class RunFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunFailedError";
  }
}

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
  if (
    type === "frame" ||
    type === "result" ||
    type === "input" ||
    type === "output" ||
    type === "waiting"
  ) {
    return parsed as HelperEvent;
  }
  return null;
}

function toLiveFrame(event: HelperFrameEvent): LiveFrame | null {
  if (typeof event.data !== "string" || event.data.length === 0) return null;
  return {
    seq: typeof event.seq === "number" ? event.seq : 0,
    atMs: typeof event.atMs === "number" ? event.atMs : 0,
    format: typeof event.format === "string" ? event.format : "jpeg",
    data: event.data,
  };
}

export interface RunOutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export interface RunOptions {
  onFrame?: (frame: LiveFrame) => void;
  onInput?: (prompt: string) => void;
  onOutput?: (chunk: RunOutputChunk) => void;
  runs?: RunRegistry;
  signal?: AbortSignal;
}

export async function runInContainer(
  container: string,
  request: RunRequest,
  config: RunnerConfig,
  options: RunOptions = {},
): Promise<ContainerRunResult> {
  const timeoutMs = request.timeoutMs ?? config.runTimeoutMs;
  const needsDisplay = projectNeedsDisplay(request.files);
  const runId = request.runId ?? randomUUID().replace(/-/g, "").slice(0, 16);

  const payload = JSON.stringify({
    runId,
    files: request.files,
    entryFile: request.entryFile,
    timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    capture: needsDisplay,
    capturePolicy: {
      firstCaptureAtMs: config.firstCaptureAtMs ?? DEFAULT_CAPTURE_POLICY.firstCaptureAtMs,
      stableMs: config.stableMs ?? DEFAULT_CAPTURE_POLICY.stableMs,
      streamFps: config.streamFps ?? DEFAULT_CAPTURE_POLICY.streamFps,
      streamQuality: config.streamQuality ?? DEFAULT_CAPTURE_POLICY.streamQuality,
      streamWidth: config.streamWidth ?? DEFAULT_CAPTURE_POLICY.streamWidth,
    },
    screen: config.screen,
    forceFallbackCapture: config.forceFallbackCapture,
  });

  // An array, not a `let`: a `let` assigned only inside the callback stays narrowed to `null`.
  const results: HelperResultEvent[] = [];

  const transport = await runDockerStreaming(["exec", "-i", container, "snapjaw-exec"], {
    // One line, because the helper keeps reading stdin afterwards for answers to input().
    input: `${payload}\n`,
    timeoutMs: transportTimeoutMs(config),
    idleTimeoutMs: config.transportIdleMs,
    // The program reads its answers from the same stdin, so the pipe stays open for the run.
    keepStdinOpen: true,
    onStart: (handle) => options.runs?.register(runId, handle),
    signal: options.signal,
    onStdoutLine: (line) => {
      const event = parseHelperLine(line);
      if (!event) return;

      if (event.type === "frame") {
        const frame = toLiveFrame(event);
        if (frame && options.onFrame) options.onFrame(frame);
        return;
      }

      if (event.type === "input") {
        options.runs?.expectsInput(runId);
        options.onInput?.(typeof event.prompt === "string" ? event.prompt : "");
        return;
      }

      if (event.type === "output") {
        const text = typeof event.text === "string" ? event.text : "";
        if (text) {
          options.onOutput?.({
            stream: event.stream === "stderr" ? "stderr" : "stdout",
            text,
          });
        }
        return;
      }

      if (event.type === "waiting") return;

      results.push(event);
    },
  }).finally(() => options.runs?.unregister(runId));

  if (transport.timedOut) {
    throw new RunFailedError("the sandbox stopped responding, so the run was abandoned");
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

export async function resetContainer(
  container: string,
  logger: typeof defaultLogger = defaultLogger,
): Promise<boolean> {
  // The bracketed pattern stops pkill from matching its own command line.
  const script = [
    "cd /",
    "pkill -9 -f '[s]napjaw-exec' >/dev/null 2>&1",
    "pkill -9 -f '[s]napjaw-work' >/dev/null 2>&1",
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

export async function containerAnswers(container: string): Promise<boolean> {
  try {
    const result = await runDocker(["exec", container, "true"], { timeoutMs: 10_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}
