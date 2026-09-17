import { readApiError } from "@/lib/api/client";
import type { ProjectFile } from "@/lib/project";

export interface RunResult {
  /** File that was executed. */
  entryFile: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  /** PNG data URL of the captured turtle/tkinter window, when one was drawn. */
  image: string | null;
  timedOut: boolean;
}

export type RunOutcome = { ok: true; result: RunResult } | { ok: false; message: string };

export interface LiveFrame {
  seq: number;
  atMs: number;
  /** Data URL, ready to hand to an image or canvas. */
  src: string;
}

export interface StreamHandlers {
  onFrame?: (frame: LiveFrame) => void;
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

/**
 * Run a project and stream its display frames back as they are drawn.
 *
 * The response is newline-delimited JSON, so a turtle or tkinter program can
 * be watched live instead of only being photographed at the end. The final
 * result arrives last, exactly like the non-streaming endpoint.
 *
 * Failure is reported as a value rather than a thrown error so the caller can
 * render it in the output panel next to the program's own output.
 */
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
      body: JSON.stringify({ files: projectToFileRecord(files), entryFile }),
    });
  } catch {
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
  } catch {
    return { ok: false, message: "The connection to the sandbox was lost." };
  } finally {
    reader.releaseLock();
  }

  if (failure) return { ok: false, message: failure };
  if (!result) return { ok: false, message: "The sandbox returned an unexpected response." };
  return { ok: true, result };
}
