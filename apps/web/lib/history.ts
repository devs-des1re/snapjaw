import type { ProjectFile } from "@/lib/project";

export interface HistorySnapshot {
  files: Record<string, string>;
  entryFile: string;
  capturedAt: string;
}

export const HISTORY_SNAPSHOT_INTERVAL_MS = 10_000;
export const HISTORY_MAX_ENTRIES = 50;

function filesToRecord(files: readonly ProjectFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.name, file.content]));
}

// Order-independent content key, so tab order changes alone never count as an edit.
function recordKey(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([name, content]) => `${name}\u0000${content}`)
    .sort()
    .join("\u0001");
}

export type HistoryCapture = { history: HistorySnapshot[]; capturedAt: number };

function withSnapshot(
  history: readonly HistorySnapshot[],
  files: readonly ProjectFile[],
  entryFile: string,
  now: number,
): HistoryCapture {
  const snapshot: HistorySnapshot = {
    files: filesToRecord(files),
    entryFile,
    capturedAt: new Date(now).toISOString(),
  };
  return { history: [...history, snapshot].slice(-HISTORY_MAX_ENTRIES), capturedAt: now };
}

// Captures only if the content changed and the interval has elapsed.
export function maybeCaptureHistory(
  history: readonly HistorySnapshot[],
  files: readonly ProjectFile[],
  entryFile: string,
  now: number,
  lastCapturedAt: number | null,
): HistoryCapture | null {
  const next = filesToRecord(files);
  const latest = history.at(-1);

  if (latest && recordKey(latest.files) === recordKey(next)) return null;
  if (lastCapturedAt !== null && now - lastCapturedAt < HISTORY_SNAPSHOT_INTERVAL_MS) return null;

  return withSnapshot(history, files, entryFile, now);
}

// Captures the current project regardless of the interval, skipping an exact duplicate.
export function captureHistory(
  history: readonly HistorySnapshot[],
  files: readonly ProjectFile[],
  entryFile: string,
  now: number,
): HistoryCapture {
  const next = filesToRecord(files);
  const latest = history.at(-1);

  if (latest && recordKey(latest.files) === recordKey(next) && latest.entryFile === entryFile) {
    return { history: [...history], capturedAt: now };
  }

  return withSnapshot(history, files, entryFile, now);
}
