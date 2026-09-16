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

export function projectToFileRecord(files: readonly ProjectFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.name, file.content]));
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

/**
 * Run a project in the sandbox and return its output.
 *
 * Failure is reported as a value rather than a thrown error so the caller can
 * render it in the output panel next to the program's own output.
 */
export async function runProject(
  files: readonly ProjectFile[],
  entryFile: string,
): Promise<RunOutcome> {
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: projectToFileRecord(files), entryFile }),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        message: readApiError(payload) ?? `The sandbox returned status ${response.status}.`,
      };
    }

    const result = readRunResult(payload);
    if (!result) {
      return { ok: false, message: "The sandbox returned an unexpected response." };
    }

    return { ok: true, result };
  } catch {
    return {
      ok: false,
      message: "Could not reach Snapjaw. Check your connection and try again.",
    };
  }
}
