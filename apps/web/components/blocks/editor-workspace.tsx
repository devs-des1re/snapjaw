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
import { ShareBar, type ShareState } from "@/components/blocks/share-bar";
import { TopMenuBar } from "@/components/blocks/top-menu-bar";
import { readApiError, readSharedUrl } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import {
  checkFileName,
  clampFontSize,
  nextUntitledName,
  removeFile,
  renameFile,
  resolveActiveFile,
  updateFileContent,
  type ProjectFile,
} from "@/lib/project";
import { runProject, type RunResult } from "@/lib/run";

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

export interface EditorWorkspaceProps {
  initialFiles: ProjectFile[];
  initialActiveFile: string;
  initialFontSize: number;
}

/**
 * The whole editor surface. Used by the home page with a starter project and
 * by /s/[id] with a project loaded from the database.
 */
export function EditorWorkspace({
  initialFiles,
  initialActiveFile,
  initialFontSize,
}: EditorWorkspaceProps) {
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [activeFile, setActiveFile] = useState<string>(initialActiveFile);
  const [fontSize, setFontSize] = useState<number>(initialFontSize);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [share, setShare] = useState<ShareState>({ status: "idle" });

  const active = files.find((file) => file.name === activeFile) ?? files[0] ?? NO_FILE;

  // A captured turtle/tkinter window needs the room to be legible, so the
  // output panel grows when there is one to show.
  const hasImage = result?.image != null;

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
    setRunError(null);
    try {
      const outcome = await runProject(files, active.name);
      if (outcome.ok) {
        setResult(outcome.result);
      } else {
        setResult(null);
        setRunError(outcome.message);
      }
    } finally {
      setIsRunning(false);
    }
  }, [files, active.name, isRunning]);

  const handleShare = useCallback(async () => {
    if (isSharing) return;
    setIsSharing(true);
    setShare({ status: "sharing" });

    try {
      const response = await fetch("/api/shared-files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: Object.fromEntries(files.map((file) => [file.name, file.content])),
          entryFile: active.name,
          fontSize,
        }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setShare({
          status: "error",
          message: readApiError(payload) ?? `Sharing failed with status ${response.status}.`,
        });
        return;
      }

      const url = readSharedUrl(payload);
      if (!url) {
        setShare({ status: "error", message: "Sharing returned an unexpected response." });
        return;
      }

      setShare({ status: "shared", url });
    } catch {
      setShare({
        status: "error",
        message: "Could not reach Snapjaw. Check your connection and try again.",
      });
    } finally {
      setIsSharing(false);
    }
  }, [files, active.name, fontSize, isSharing]);

  const handleFontSizeChange = useCallback((next: number) => {
    setFontSize(clampFontSize(next));
  }, []);

  const dismissShare = useCallback(() => setShare({ status: "idle" }), []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopMenuBar
        fontSize={fontSize}
        onFontSizeChange={handleFontSizeChange}
        onRun={handleRun}
        onShare={handleShare}
        isRunning={isRunning}
        isSharing={isSharing}
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

      {/* Keyed by share state so copy feedback resets on each new share. */}
      <ShareBar
        key={share.status === "shared" ? share.url : share.status}
        state={share}
        onDismiss={dismissShare}
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

        <div
          className={cn(
            "shrink-0",
            hasImage ? "h-[52%] max-h-[30rem] min-h-52" : "h-[38%] max-h-80 min-h-36",
          )}
        >
          <OutputPanel
            result={result}
            isRunning={isRunning}
            entryFile={active.name}
            error={runError}
          />
        </div>
      </main>
    </div>
  );
}
