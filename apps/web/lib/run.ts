import { readApiError } from "@/lib/api/client";
import type { ProjectFile } from "@/lib/project";

export interface RunResult {
  entryFile: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  image: string | null;
  timedOut: boolean;
}

export type RunOutcome = { ok: true; result: RunResult } | { ok: false; message: string };

export interface LiveFrame {
  seq: number;
  atMs: number;
  src: string;
}

export interface LiveOutput {
  stream: "stdout" | "stderr";
  text: string;
}

// One ordered transcript, so a print after a failed line stays in the right place.
export interface OutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export type OutputBuffer = OutputChunk[];

export interface StreamHandlers {
  runId?: string;
  signal?: AbortSignal;
  onFrame?: (frame: LiveFrame) => void;
  onOutput?: (chunk: LiveOutput) => void;
  onInput?: (prompt: string) => void;
}

// Matches the runner's run id format, and needs no secure context the way crypto.randomUUID does.
export function newRunId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readRunResult(payload: unknown): RunResult | null {
  if (typeof payload !== "object" || payload === null) return null;

  const candidate = payload as Partial<RunResult>;
  if (
    typeof candidate.entryFile !== "string" ||
    typeof candidate.stdout !== "string" ||
    typeof candidate.stderr !== "string" ||
    typeof candidate.exitCode !== "number" ||
    typeof candidate.durationMs !== "number" ||
    typeof candidate.timedOut !== "boolean"
  ) {
    return null;
  }

  return {
    entryFile: candidate.entryFile,
    stdout: candidate.stdout,
    stderr: candidate.stderr,
    exitCode: candidate.exitCode,
    durationMs: candidate.durationMs,
    image: typeof candidate.image === "string" ? candidate.image : null,
    timedOut: candidate.timedOut,
  };
}

export function projectToFileRecord(files: readonly ProjectFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.name, file.content]));
}

// Appends a chunk, merging it into the previous one when it is the same stream so the
// transcript stays a short list rather than one entry per line.
export function appendOutput(chunks: OutputBuffer, chunk: LiveOutput): OutputBuffer {
  const last = chunks.at(-1);
  if (last && last.stream === chunk.stream) {
    return [...chunks.slice(0, -1), { stream: last.stream, text: last.text + chunk.text }];
  }
  return [...chunks, { stream: chunk.stream, text: chunk.text }];
}

// Newline-delimited JSON: frames arrive as they are drawn, the final result last.
export async function runProjectStreaming(
  files: readonly ProjectFile[],
  entryFile: string,
  handlers: StreamHandlers = {},
): Promise<RunOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/run/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: projectToFileRecord(files), entryFile, runId: handlers.runId }),
      signal: handlers.signal,
    });
  } catch (error) {
    if (isAbortError(error)) return { ok: false, message: "Run stopped." };
    return { ok: false, message: "Could not reach Snapjaw. Check your connection and try again." };
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    return {
      ok: false,
      message: readApiError(payload) ?? `The sandbox returned status ${response.status}.`,
    };
  }

  if (!response.body) {
    return { ok: false, message: "The sandbox returned an empty response." };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: RunResult | null = null;
  let failure: string | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (typeof event !== "object" || event === null) return;
    const { type } = event as { type?: unknown };

    if (type === "frame") {
      const { data, format, seq, atMs } = event as {
        data?: unknown;
        format?: unknown;
        seq?: unknown;
        atMs?: unknown;
      };
      if (typeof data === "string" && data.length > 0) {
        const mime = typeof format === "string" && format === "png" ? "png" : "jpeg";
        handlers.onFrame?.({
          seq: typeof seq === "number" ? seq : 0,
          atMs: typeof atMs === "number" ? atMs : 0,
          src: `data:image/${mime};base64,${data}`,
        });
      }
      return;
    }

    if (type === "output") {
      const { stream, text } = event as { stream?: unknown; text?: unknown };
      if (typeof text === "string" && text.length > 0) {
        handlers.onOutput?.({ stream: stream === "stderr" ? "stderr" : "stdout", text });
      }
      return;
    }

    if (type === "input") {
      const { prompt } = event as { prompt?: unknown };
      handlers.onInput?.(typeof prompt === "string" ? prompt : "");
      return;
    }

    if (type === "error") {
      const { message } = event as { message?: unknown };
      failure = typeof message === "string" ? message : "The sandbox failed during the run.";
      return;
    }

    if (type === "result") {
      result = readRunResult(event);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      let index = pending.indexOf("\n");
      while (index !== -1) {
        handleLine(pending.slice(0, index));
        pending = pending.slice(index + 1);
        index = pending.indexOf("\n");
      }
    }
    handleLine(pending);
  } catch (error) {
    if (isAbortError(error)) return { ok: false, message: "Run stopped." };
    return { ok: false, message: "The connection to the sandbox was lost." };
  } finally {
    reader.releaseLock();
  }

  if (failure) return { ok: false, message: failure };
  if (!result) return { ok: false, message: "The sandbox returned an unexpected response." };
  return { ok: true, result };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export type InputOutcome = { ok: true } | { ok: false; message: string };

// One line for a program that is blocked on input().
export async function sendRunInput(runId: string, value: string): Promise<InputOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/run/input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, value }),
    });
  } catch {
    return { ok: false, message: "Could not reach Snapjaw. Check your connection and try again." };
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    return {
      ok: false,
      message: readApiError(payload) ?? "The program is no longer waiting for input.",
    };
  }

  return { ok: true };
}
