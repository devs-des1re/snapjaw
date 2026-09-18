"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";

import {
  EDITOR_TABPANEL_ID,
  FileTabs,
  fileTabId,
  type FileTabsHandle,
  type RenameOutcome,
} from "@/components/blocks/file-tabs";
import { HistoryDialog } from "@/components/blocks/history-dialog";
import { OutputPanel } from "@/components/blocks/output-panel";
import { ShareBar, type ShareState } from "@/components/blocks/share-bar";
import { SplitPane, useIsNarrow } from "@/components/blocks/split-pane";
import { TopMenuBar } from "@/components/blocks/top-menu-bar";
import { Dialog } from "@/components/ui/dialog";
import type { MenuSpec } from "@/components/ui/menu";
import { readApiError, readSharedUrl } from "@/lib/api/client";
import {
  captureHistory,
  maybeCaptureHistory,
  type HistorySnapshot,
} from "@/lib/history";
import {
  checkFileName,
  clampFontSize,
  DEFAULT_FONT_SIZE,
  nextUntitledName,
  removeFile,
  renameFile,
  resolveActiveFile,
  updateFileContent,
  type ProjectFile,
} from "@/lib/project";
import {
  appendOutput,
  newRunId,
  runProjectStreaming,
  sendRunInput,
  type LiveFrame,
  type LiveOutput,
  type OutputBuffer,
  type RunResult,
} from "@/lib/run";
import { projectZip } from "@/lib/zip";

// Monaco is browser-only, so the editor is loaded on the client.
const EditorPanel = dynamic(
  () => import("@/components/blocks/editor-panel").then((module) => module.EditorPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
        Loading editor…
      </div>
    ),
  },
);

const NO_FILE: ProjectFile = { name: "", content: "" };

type PanelPosition = "right" | "bottom" | "left";

export interface EditorWorkspaceProps {
  initialFiles: ProjectFile[];
  initialActiveFile: string;
  initialFontSize: number;
  history?: HistorySnapshot[];
}

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl + Enter", "Run the active file"],
  ["Ctrl + Shift + H", "View the project's code history"],
  ["Ctrl + Z / Ctrl + Shift + Z", "Undo and redo"],
  ["Ctrl + /", "Toggle comment"],
  ["Ctrl + F / Ctrl + H", "Find and replace"],
  ["Ctrl + mouse wheel", "Editor font size"],
  ["F2", "Rename the active file"],
  ["Esc", "Close a menu or dialog"],
];

// The whole editor surface, shared by the home page and /file/[id].
export function EditorWorkspace({
  initialFiles,
  initialActiveFile,
  initialFontSize,
  history: initialHistory = [],
}: EditorWorkspaceProps) {
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [activeFile, setActiveFile] = useState<string>(initialActiveFile);
  const [fontSize, setFontSize] = useState<number>(initialFontSize);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [share, setShare] = useState<ShareState>({ status: "idle" });
  const [panelPosition, setPanelPosition] = useState<PanelPosition>("right");
  const [wordWrap, setWordWrap] = useState(false);
  const [minimap, setMinimap] = useState(false);
  const [dialog, setDialog] = useState<"shortcuts" | "history" | null>(null);
  const [liveOutput, setLiveOutput] = useState<OutputBuffer>([]);
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [isSendingInput, setIsSendingInput] = useState(false);
  const [history, setHistory] = useState<HistorySnapshot[]>(initialHistory);

  // Frames bypass React state: setState coalesced them and dropped most of the animation.
  const liveFrameRef = useRef<LiveFrame | null>(null);
  const frameCountRef = useRef(0);
  const lastFrameStatusAt = useRef(0);

  // Transcript text lands far more often than the console needs repainting.
  const liveOutputRef = useRef<OutputBuffer>([]);
  const lastOutputFlushAt = useRef(0);
  const runIdRef = useRef<string | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  // History state lives in refs too, so the capture effect does not re-run on every edit.
  const historyRef = useRef<HistorySnapshot[]>(initialHistory);
  const lastHistoryAtRef = useRef<number | null>(null);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const fileTabsRef = useRef<FileTabsHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const active = files.find((file) => file.name === activeFile) ?? files[0] ?? NO_FILE;
  const narrow = useIsNarrow();

  // Side by side does not fit on a phone, so narrow screens always stack.
  const position: PanelPosition = narrow ? "bottom" : panelPosition;
  const sideBySide = position !== "bottom";

  const commitHistory = useCallback(
    (next: HistorySnapshot[], capturedAt: number) => {
      historyRef.current = next;
      lastHistoryAtRef.current = capturedAt;
      setHistory(next);
    },
    [],
  );

  // Snapshots are taken at most every ten seconds, and only while the project changes.
  useEffect(() => {
    const captured = maybeCaptureHistory(
      historyRef.current,
      files,
      active.name,
      Date.now(),
      lastHistoryAtRef.current,
    );
    if (captured) commitHistory(captured.history, captured.capturedAt);
  }, [files, active.name, commitHistory]);

  useEffect(() => {
    const pane = editorPaneRef.current;
    if (!pane) return;

    let travelled = 0;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      travelled += event.deltaY;
      const steps = Math.trunc(travelled / 40);
      if (steps === 0) return;

      travelled -= steps * 40;
      setFontSize((current) => clampFontSize(current - steps));
    };

    pane.addEventListener("wheel", onWheel, { passive: false });
    return () => pane.removeEventListener("wheel", onWheel);
  }, []);

  const pushOutput = useCallback((chunk: LiveOutput) => {
    liveOutputRef.current = appendOutput(liveOutputRef.current, chunk);

    const now = Date.now();
    if (now - lastOutputFlushAt.current >= 100) {
      lastOutputFlushAt.current = now;
      setLiveOutput(liveOutputRef.current);
    }
  }, []);

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    setRunError(null);
    setResult(null);
    setStopped(false);
    setFrameCount(0);
    setInputError(null);
    setAwaitingInput(false);
    liveFrameRef.current = null;
    frameCountRef.current = 0;
    lastFrameStatusAt.current = 0;
    liveOutputRef.current = [];
    lastOutputFlushAt.current = 0;
    setLiveOutput(liveOutputRef.current);
    stoppedRef.current = false;

    const controller = new AbortController();
    runAbortRef.current = controller;

    const runId = newRunId();
    runIdRef.current = runId;

    try {
      const outcome = await runProjectStreaming(files, active.name, {
        runId,
        signal: controller.signal,
        onFrame: (frame) => {
          liveFrameRef.current = frame;
          frameCountRef.current += 1;

          // Only the status line needs state, throttled so frames do not trigger renders.
          const now = Date.now();
          if (frameCountRef.current === 1 || now - lastFrameStatusAt.current >= 200) {
            lastFrameStatusAt.current = now;
            setFrameCount(frameCountRef.current);
          }
        },
        onOutput: pushOutput,
        onInput: () => setAwaitingInput(true),
      });

      // A run the user cancelled is not a failure, so only the transcript is kept.
      if (stoppedRef.current) {
        setStopped(true);
      } else if (outcome.ok) {
        setResult(outcome.result);
      } else {
        setRunError(outcome.message);
      }
    } finally {
      liveFrameRef.current = null;
      runIdRef.current = null;
      runAbortRef.current = null;
      setFrameCount(frameCountRef.current);
      setAwaitingInput(false);
      setIsRunning(false);
    }
  }, [files, active.name, isRunning, pushOutput]);

  const handleStop = useCallback(() => {
    if (!runAbortRef.current) return;
    stoppedRef.current = true;
    runAbortRef.current.abort();
  }, []);

  const handleSubmitInput = useCallback(
    async (value: string) => {
      const runId = runIdRef.current;
      if (!runId || isSendingInput) return;

      setIsSendingInput(true);
      setInputError(null);
      setAwaitingInput(false);

      const outcome = await sendRunInput(runId, value);
      if (!outcome.ok) setInputError(outcome.message);

      setIsSendingInput(false);
    },
    [isSendingInput],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        setDialog("history");
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        // Capture phase, and stopped here: Monaco binds Ctrl+Enter and would swallow the run.
        event.stopPropagation();
        void handleRun();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleRun]);

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

  const handleShare = useCallback(async () => {
    if (isSharing) return;
    setIsSharing(true);
    setShare({ status: "sharing" });

    const captured = captureHistory(historyRef.current, files, active.name, Date.now());
    commitHistory(captured.history, captured.capturedAt);

    try {
      const response = await fetch("/api/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: Object.fromEntries(files.map((file) => [file.name, file.content])),
          entryFile: active.name,
          fontSize,
          history: captured.history,
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
  }, [files, active.name, fontSize, isSharing, commitHistory]);

  const handleFontSizeChange = useCallback((next: number) => {
    setFontSize(clampFontSize(next));
  }, []);

  const dismissShare = useCallback(() => setShare({ status: "idle" }), []);

  const handleEditorReady = useCallback((mounted: editor.IStandaloneCodeEditor) => {
    editorRef.current = mounted;
  }, []);

  const runEditorAction = useCallback((actionId: string) => {
    const mounted = editorRef.current;
    if (!mounted) return;
    mounted.focus();
    void mounted.getAction(actionId)?.run();
  }, []);

  const jumpToLine = useCallback(
    (file: string, line: number) => {
      const target = files.find((candidate) => candidate.name === file);
      if (!target) {
        setFileNotice(`No file named ${file} in this project.`);
        return;
      }

      setActiveFile(file);
      setFileNotice(null);

      requestAnimationFrame(() => {
        const mounted = editorRef.current;
        if (!mounted) return;
        mounted.focus();
        mounted.revealLineInCenter(line);
        mounted.setPosition({ lineNumber: line, column: 1 });
      });
    },
    [files],
  );

  const createFileFromMenu = useCallback(() => {
    const name = handleCreate();
    if (name) requestAnimationFrame(() => fileTabsRef.current?.beginRename(name));
  }, [handleCreate]);

  const downloadActiveFile = useCallback(() => {
    const blob = new Blob([active.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = active.name || "snapjaw.py";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [active]);

  const downloadProject = useCallback(() => {
    const bytes = projectZip("snapjaw-project", files);
    const blob = new Blob([bytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "snapjaw-project.zip";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [files]);

  const loadVersion = useCallback(
    (nextFiles: ProjectFile[], entryFile: string) => {
      setFiles(nextFiles);
      setActiveFile(entryFile || nextFiles[0]?.name || "");
      setDialog(null);
      setFileNotice(null);
    },
    [],
  );

  const clearOutput = useCallback(() => {
    setResult(null);
    setRunError(null);
    setStopped(false);
    setFrameCount(0);
    setInputError(null);
    liveOutputRef.current = [];
    setLiveOutput(liveOutputRef.current);
  }, []);

  const menus: MenuSpec[] = [
    {
      label: "File",
      entries: [
        { kind: "item", label: "New file", shortcut: "Ctrl+N", onSelect: createFileFromMenu },
        {
          kind: "item",
          label: "Open file…",
          onSelect: () => fileInputRef.current?.click(),
        },
        { kind: "separator" },
        { kind: "item", label: "Download this file", onSelect: downloadActiveFile },
        { kind: "item", label: "Download project (.zip)", onSelect: downloadProject },
        { kind: "separator" },
        { kind: "item", label: "Share…", onSelect: () => void handleShare() },
      ],
    },
    {
      label: "Edit",
      entries: [
        {
          kind: "item",
          label: "Undo",
          shortcut: "Ctrl+Z",
          onSelect: () => runEditorAction("undo"),
        },
        {
          kind: "item",
          label: "Redo",
          shortcut: "Ctrl+Shift+Z",
          onSelect: () => runEditorAction("redo"),
        },
        { kind: "separator" },
        {
          kind: "item",
          label: "Cut",
          shortcut: "Ctrl+X",
          onSelect: () => runEditorAction("editor.action.clipboardCutAction"),
        },
        {
          kind: "item",
          label: "Copy",
          shortcut: "Ctrl+C",
          onSelect: () => runEditorAction("editor.action.clipboardCopyAction"),
        },
        {
          kind: "item",
          label: "Paste",
          shortcut: "Ctrl+V",
          onSelect: () => runEditorAction("editor.action.clipboardPasteAction"),
        },
        { kind: "separator" },
        {
          kind: "item",
          label: "Find",
          shortcut: "Ctrl+F",
          onSelect: () => runEditorAction("actions.find"),
        },
        {
          kind: "item",
          label: "Replace",
          shortcut: "Ctrl+H",
          onSelect: () => runEditorAction("editor.action.startFindReplaceAction"),
        },
        {
          kind: "item",
          label: "Toggle comment",
          shortcut: "Ctrl+/",
          onSelect: () => runEditorAction("editor.action.commentLine"),
        },
        {
          kind: "item",
          label: "Select all",
          shortcut: "Ctrl+A",
          onSelect: () => runEditorAction("editor.action.selectAll"),
        },
      ],
    },
    {
      label: "View",
      entries: [
        {
          kind: "radio",
          label: "Output on the right",
          checked: panelPosition === "right",
          onSelect: () => setPanelPosition("right"),
        },
        {
          kind: "radio",
          label: "Output at the bottom",
          checked: panelPosition === "bottom",
          onSelect: () => setPanelPosition("bottom"),
        },
        {
          kind: "radio",
          label: "Output on the left",
          checked: panelPosition === "left",
          onSelect: () => setPanelPosition("left"),
        },
        { kind: "separator" },
        {
          kind: "checkbox",
          label: "Word wrap",
          checked: wordWrap,
          onSelect: () => setWordWrap((current) => !current),
        },
        {
          kind: "checkbox",
          label: "Minimap",
          checked: minimap,
          onSelect: () => setMinimap((current) => !current),
        },
        { kind: "separator" },
        {
          kind: "item",
          label: "Increase font size",
          onSelect: () => setFontSize((current) => clampFontSize(current + 1)),
        },
        {
          kind: "item",
          label: "Decrease font size",
          onSelect: () => setFontSize((current) => clampFontSize(current - 1)),
        },
        {
          kind: "item",
          label: "Reset font size",
          onSelect: () => setFontSize(DEFAULT_FONT_SIZE),
        },
      ],
    },
    {
      label: "Run",
      entries: [
        {
          kind: "item",
          label: isRunning ? "Running…" : `Run ${active.name}`,
          shortcut: "Ctrl+Enter",
          disabled: isRunning,
          onSelect: () => void handleRun(),
        },
        {
          kind: "item",
          label: "Stop",
          disabled: !isRunning,
          onSelect: handleStop,
        },
        { kind: "separator" },
        {
          kind: "item",
          label: "Clear output",
          disabled: result === null && runError === null && !stopped,
          onSelect: clearOutput,
        },
      ],
    },
    {
      label: "Help",
      entries: [
        { kind: "item", label: "Keyboard shortcuts", onSelect: () => setDialog("shortcuts") },
        {
          kind: "item",
          label: "Code history",
          shortcut: "Ctrl+Shift+H",
          onSelect: () => setDialog("history"),
        },
      ],
    },
  ];

  const editorPane = (
    <div
      id={EDITOR_TABPANEL_ID}
      role="tabpanel"
      aria-labelledby={fileTabId(active.name)}
      className="relative h-full"
    >
      <div ref={editorPaneRef} className="absolute inset-0">
        <EditorPanel
          file={active}
          fontSize={fontSize}
          wordWrap={wordWrap}
          minimap={minimap}
          onChange={handleContentChange}
          onReady={handleEditorReady}
        />
      </div>
    </div>
  );

  const outputPane = (
    <OutputPanel
      result={result}
      isRunning={isRunning}
      entryFile={active.name}
      error={runError}
      stopped={stopped}
      liveFrameRef={liveFrameRef}
      frameCount={frameCount}
      liveOutput={liveOutput}
      awaitingInput={awaitingInput}
      inputError={inputError}
      isSendingInput={isSendingInput}
      onSubmitInput={(value) => void handleSubmitInput(value)}
      onClear={clearOutput}
      onJumpToLine={jumpToLine}
    />
  );

  const outputFirst = position === "left";

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopMenuBar
        menus={menus}
        fontSize={fontSize}
        onFontSizeChange={handleFontSizeChange}
        onRun={() => void handleRun()}
        onStop={handleStop}
        onShare={() => void handleShare()}
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
        handleRef={fileTabsRef}
        inputRef={fileInputRef}
      />

      <ShareBar
        key={share.status === "shared" ? share.url : share.status}
        state={share}
        onDismiss={dismissShare}
      />

      <main className="flex min-h-0 flex-1 flex-col">
        <SplitPane
          key={`${sideBySide ? "side" : "stack"}-${outputFirst ? "output" : "editor"}`}
          orientation={sideBySide ? "side-by-side" : "stacked"}
          initialSize={sideBySide ? 62 : 46}
          first={outputFirst ? outputPane : editorPane}
          second={outputFirst ? editorPane : outputPane}
        />
      </main>

      <Dialog
        open={dialog === "shortcuts"}
        title="Keyboard shortcuts"
        onClose={() => setDialog(null)}
      >
        <dl className="space-y-1.5">
          {SHORTCUTS.map(([keys, meaning]) => (
            <div key={keys} className="flex items-baseline gap-3">
              <dt className="w-56 shrink-0 font-mono text-2xs text-fg">{keys}</dt>
              <dd className="flex-1">{meaning}</dd>
            </div>
          ))}
        </dl>
      </Dialog>

      <HistoryDialog
        open={dialog === "history"}
        history={history}
        onClose={() => setDialog(null)}
        onRestore={loadVersion}
      />
    </div>
  );
}
