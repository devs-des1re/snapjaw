"use client";

import { useCallback } from "react";
import Editor, { loader, type Monaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

import type { ProjectFile } from "@/lib/project";

const SNAPJAW_THEME = "snapjaw-dark";

const MONACO_FONT_FAMILY =
  "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".py": "python",
  ".json": "json",
  ".md": "markdown",
  ".txt": "plaintext",
  ".html": "html",
  ".css": "css",
  ".js": "javascript",
  ".ts": "typescript",
};

function languageForFile(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  return LANGUAGE_BY_EXTENSION[name.slice(dot).toLowerCase()] ?? "plaintext";
}

// The package exports map rebases this specifier onto esm/vs/; only the core worker is needed.
if (typeof self !== "undefined") {
  (self as unknown as { MonacoEnvironment?: { getWorker: () => Worker } }).MonacoEnvironment = {
    getWorker: () =>
      new Worker(new URL("monaco-editor/editor/editor.worker.js", import.meta.url), {
        type: "module",
        name: "snapjaw-editor-worker",
      }),
  };
}

loader.config({ monaco });

// A VS Code Dark+ style palette: keywords, strings, numbers and calls each get
// their own hue rather than everything sharing the brand blue.
function defineSnapjawTheme(monacoInstance: Monaco): void {
  monacoInstance.editor.defineTheme(SNAPJAW_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "d4d4d8", background: "0d0d0f" },
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "keyword", foreground: "c586c0" },
      { token: "keyword.control", foreground: "c586c0" },
      { token: "string", foreground: "ce9178" },
      { token: "string.escape", foreground: "d7ba7d" },
      { token: "number", foreground: "b5cea8" },
      { token: "constant", foreground: "4fc1ff" },
      { token: "type", foreground: "4ec9b0" },
      { token: "type.identifier", foreground: "4ec9b0" },
      { token: "identifier", foreground: "d4d4d8" },
      { token: "function", foreground: "dcdcaa" },
      { token: "delimiter", foreground: "9ca3af" },
      { token: "operator", foreground: "d4d4d8" },
      { token: "tag", foreground: "569cd6" },
      { token: "attribute.name", foreground: "9cdcfe" },
    ],
    colors: {
      "editor.background": "#0d0d0f",
      "editor.foreground": "#d4d4d8",
      "editorGutter.background": "#0d0d0f",
      "editorLineNumber.foreground": "#3f3f46",
      "editorLineNumber.activeForeground": "#a1a1a8",
      "editor.lineHighlightBackground": "#1c1c20",
      "editor.selectionBackground": "#3f3f4688",
      "editor.inactiveSelectionBackground": "#3f3f4644",
      "editorCursor.foreground": "#d4d4d8",
      "editorIndentGuide.background1": "#1f1f23",
      "editorIndentGuide.activeBackground1": "#3d3d45",
      "editorWhitespace.foreground": "#2b2b31",
      "editorWidget.background": "#1c1c20",
      "editorWidget.border": "#2b2b31",
      "editorSuggestWidget.background": "#1c1c20",
      "editorSuggestWidget.border": "#2b2b31",
      "editorSuggestWidget.selectedBackground": "#26262b",
      "editorBracketMatch.background": "#3f3f4666",
      "editorBracketMatch.border": "#71717a",
      "editorBracketHighlight.foreground1": "#d4d4d8",
      "editorBracketHighlight.foreground2": "#c586c0",
      "editorBracketHighlight.foreground3": "#4ec9b0",
      "editorBracketHighlight.foreground4": "#ce9178",
      "editorBracketHighlight.foreground5": "#dcdcaa",
      "editorBracketHighlight.foreground6": "#569cd6",
      "editorBracketHighlight.unexpectedBracket.foreground": "#ff6b6b",
      "scrollbarSlider.background": "#3d3d4577",
      "scrollbarSlider.hoverBackground": "#3d3d45aa",
      "scrollbarSlider.activeBackground": "#3d3d45",
    },
  });
}

function EditorLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
      Loading editor…
    </div>
  );
}

export interface EditorPanelProps {
  file: ProjectFile;
  fontSize: number;
  onChange: (content: string) => void;
}

export function EditorPanel({ file, fontSize, onChange }: EditorPanelProps) {
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (typeof value === "string") onChange(value);
    },
    [onChange],
  );

  return (
    <Editor
      path={file.name}
      value={file.content}
      language={languageForFile(file.name)}
      theme={SNAPJAW_THEME}
      beforeMount={defineSnapjawTheme}
      onChange={handleChange}
      loading={<EditorLoading />}
      options={{
        ariaLabel: `Code editor for ${file.name}`,
        fontSize,
        fontFamily: MONACO_FONT_FAMILY,
        fontLigatures: false,
        minimap: { enabled: false },
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        cursorBlinking: "solid",
        renderLineHighlight: "line",
        renderWhitespace: "selection",
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        padding: { top: 12, bottom: 12 },
        overviewRulerLanes: 0,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
          useShadows: false,
        },
        fixedOverflowWidgets: true,
      }}
    />
  );
}
