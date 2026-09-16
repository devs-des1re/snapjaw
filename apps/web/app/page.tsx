"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";

import {
  EDITOR_TABPANEL_ID,
  FileTabs,
  fileTabId,
  type RenameOutcome,
} from "@/components/blocks/file-tabs";
import { OutputPanel } from "@/components/blocks/output-panel";
import { TopMenuBar } from "@/components/blocks/top-menu-bar";
import {
  checkFileName,
  clampFontSize,
  DEFAULT_ACTIVE_FILE,
  DEFAULT_FILES,
  DEFAULT_FONT_SIZE,
  nextUntitledName,
  removeFile,
  renameFile,
  resolveActiveFile,
  updateFileContent,
  type ProjectFile,
} from "@/lib/project";
import { mockRun, type RunResult } from "@/lib/run";

/**
 * Monaco only exists in the browser, so the editor is loaded on the client.
 * `h-full` on the loading state keeps the panel from collapsing while it
 * arrives.
 */
const EditorPanel = dynamic(
  () => import("@/components/blocks/editor-panel").then((module) => module.EditorPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center font-mono text-sm text-fg-subtle">
        Loading editor…
      </div>
    ),
  },
);

const NO_FILE: ProjectFile = { name: "", content: "" };

export default function Page() {
  const [files, setFiles] = useState<ProjectFile[]>(DEFAULT_FILES);
  const [activeFile, setActiveFile] = useState<string>(DEFAULT_ACTIVE_FILE);
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [result, setResult] = useState<RunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  const active = files.find((file) => file.name === activeFile) ?? files[0] ?? NO_FILE;

  const handleSelect = useCallback((name: string) => {
    setActiveFile(name);
    setFileNotice(null);
  }, []);

  const handleContentChange = useCallback(
    (content: string) => {
      setFiles((previous) => updateFileContent(previous, activeFile, content));
    },
    [activeFile],
  );

  const handleCreate = useCallback((): string | null => {
    const name = nextUntitledName(files.map((file) => file.name));
    setFiles((previous) => [...previous, { name, content: "" }]);
    setActiveFile(name);
    setFileNotice(null);
    return name;
  }, [files]);

  const handleOpenFiles = useCallback(
    async (list: FileList) => {
      const incoming: ProjectFile[] = [];
      const problems: string[] = [];
      const taken = files.map((file) => file.name);

      for (const file of Array.from(list)) {
        const check = checkFileName(file.name, taken);
        if (!check.ok) {
          problems.push(check.error);
          continue;
        }
        taken.push(check.name);
        incoming.push({ name: check.name, content: await file.text() });
      }

      if (incoming.length > 0) {
        setFiles((previous) => [...previous, ...incoming]);
        const last = incoming[incoming.length - 1];
        if (last) setActiveFile(last.name);
      }

      setFileNotice(problems.length > 0 ? problems.join(" ") : null);
    },
    [files],
  );

  const handleRename = useCallback(
    (from: string, to: string): RenameOutcome => {
      const check = checkFileName(
        to,
        files.map((file) => file.name),
        from,
      );
      if (!check.ok) return { ok: false, error: check.error };
      if (check.name === from) return { ok: true };

      setFiles((previous) => renameFile(previous, from, check.name));
      setActiveFile((current) => (current === from ? check.name : current));
      setFileNotice(null);
      return { ok: true };
    },
    [files],
  );

  const handleClose = useCallback(
    (name: string) => {
      if (files.length <= 1) return;
      const remaining = removeFile(files, name);
      setFiles(remaining);
      if (activeFile === name) setActiveFile(resolveActiveFile(remaining, ""));
      setFileNotice(null);
    },
    [files, activeFile],
  );

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    setShareNotice(null);
    try {
      setResult(await mockRun(files, active.name));
    } finally {
      setIsRunning(false);
    }
  }, [files, active.name, isRunning]);

  const handleShare = useCallback(() => {
    setShareNotice("Sharing saves your files to the database in the next build.");
  }, []);

  const handleFontSizeChange = useCallback((next: number) => {
    setFontSize(clampFontSize(next));
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopMenuBar
        fontSize={fontSize}
        onFontSizeChange={handleFontSizeChange}
        onRun={handleRun}
        onShare={handleShare}
        isRunning={isRunning}
        notice={shareNotice}
      />

      <FileTabs
        files={files}
        activeFile={active.name}
        notice={fileNotice}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onOpenFiles={handleOpenFiles}
        onRename={handleRename}
        onClose={handleClose}
      />

      <main className="flex min-h-0 flex-1 flex-col">
        <div
          id={EDITOR_TABPANEL_ID}
          role="tabpanel"
          aria-labelledby={fileTabId(active.name)}
          className="relative min-h-0 flex-1 border-b border-line"
        >
          <div className="absolute inset-0">
            <EditorPanel file={active} fontSize={fontSize} onChange={handleContentChange} />
          </div>
        </div>

        <div className="h-[38%] max-h-80 min-h-36 shrink-0">
          <OutputPanel result={result} isRunning={isRunning} entryFile={active.name} />
        </div>
      </main>
    </div>
  );
}
