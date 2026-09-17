export const PYTHON_EXTENSION = ".py";

export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 28;

export const MAX_FILE_NAME_LENGTH = 64;

export interface ProjectFile {
  name: string;
  content: string;
}

export const STARTER_CONTENT = `def main():
    print("Hello from Snapjaw!")


if __name__ == "__main__":
    main()
`;

export const DEFAULT_FILES: ProjectFile[] = [{ name: "main.py", content: STARTER_CONTENT }];

export const DEFAULT_ACTIVE_FILE = "main.py";

export function normalizeFileName(raw: string): string {
  const base = raw.trim().split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned) return "";
  return cleaned.includes(".") ? cleaned : `${cleaned}${PYTHON_EXTENSION}`;
}

export function uniqueFileName(desired: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;

  const dot = desired.lastIndexOf(".");
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const extension = dot > 0 ? desired.slice(dot) : "";

  let counter = 2;
  while (taken.has(`${stem}-${counter}${extension}`.toLowerCase())) {
    counter += 1;
  }
  return `${stem}-${counter}${extension}`;
}

export function nextUntitledName(existing: readonly string[]): string {
  return uniqueFileName("untitled.py", existing);
}

export type FileNameCheck = { ok: true; name: string } | { ok: false; error: string };

export function checkFileName(
  raw: string,
  existing: readonly string[],
  currentName?: string,
): FileNameCheck {
  const name = normalizeFileName(raw);

  if (!name) {
    return { ok: false, error: "Enter a file name." };
  }
  if (name.length > MAX_FILE_NAME_LENGTH) {
    return { ok: false, error: `File names are limited to ${MAX_FILE_NAME_LENGTH} characters.` };
  }

  const lower = name.toLowerCase();
  const clash = existing.some(
    (other) => other.toLowerCase() === lower && other.toLowerCase() !== currentName?.toLowerCase(),
  );
  if (clash) {
    return { ok: false, error: `A file named ${name} already exists.` };
  }

  return { ok: true, name };
}

export function updateFileContent(
  files: readonly ProjectFile[],
  name: string,
  content: string,
): ProjectFile[] {
  return files.map((file) => (file.name === name ? { ...file, content } : file));
}

export function renameFile(files: readonly ProjectFile[], from: string, to: string): ProjectFile[] {
  return files.map((file) => (file.name === from ? { ...file, name: to } : file));
}

export function removeFile(files: readonly ProjectFile[], name: string): ProjectFile[] {
  return files.filter((file) => file.name !== name);
}

export function resolveActiveFile(files: readonly ProjectFile[], active: string): string {
  if (files.some((file) => file.name === active)) return active;
  return files[0]?.name ?? "";
}

// jsonb does not preserve key order, so tab order is rebuilt: entry file first, then alphabetical.
export function projectFilesFromRecord(
  files: Record<string, string>,
  entryFile: string,
): { files: ProjectFile[]; activeFile: string } {
  const names = Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const ordered = names.includes(entryFile)
    ? [entryFile, ...names.filter((name) => name !== entryFile)]
    : names;

  const projectFiles = ordered.map((name) => ({ name, content: files[name] ?? "" }));
  return { files: projectFiles, activeFile: projectFiles[0]?.name ?? "" };
}

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));
}
