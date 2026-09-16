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

const MOCK_LATENCY_MS = 420;

/**
 * Phase 1 placeholder for `/api/run`.
 *
 * Nothing is executed. Phase 3 replaces the body of this function with a POST
 * to the sandbox runner and leaves the `RunResult` contract untouched, so the
 * output panel needs no changes.
 */
export async function mockRun(
  files: readonly ProjectFile[],
  entryFile: string,
): Promise<RunResult> {
  const startedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

  const entry = files.find((file) => file.name === entryFile);
  const lines = entry ? entry.content.split("\n").length : 0;
  const firstLine = entry?.content.split("\n")[0]?.trim() ?? "";
  const fileList = files.map((file) => file.name).join(", ");

  const stdout = [
    `$ python ${entryFile}`,
    "",
    "Snapjaw preview build — nothing was executed.",
    "",
    `  entry : ${entryFile}`,
    `  lines : ${lines}`,
    `  first : ${firstLine}`,
    `  files : ${fileList}`,
    "",
    "Real sandboxed execution, turtle and tkinter included, arrives with the",
    "sandbox runner in the next build.",
    "",
  ].join("\n");

  return {
    entryFile,
    stdout,
    stderr: "",
    exitCode: 0,
    durationMs: Date.now() - startedAt,
    image: null,
    timedOut: false,
  };
}
