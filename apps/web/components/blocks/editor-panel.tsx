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

/**
 * Monaco ships from npm rather than a CDN, so the editor works with no network
 * access. Only the core editor worker is registered — there is no Python
 * language server, so no other worker is needed.
 *
 * The specifier is relative to the package's exports map, which rebases
 * everything onto `esm/vs/`.
 */
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

function defineSnapjawTheme(monacoInstance: Monaco): void {
  monacoInstance.editor.defineTheme(SNAPJAW_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e6e9ed", background: "0a0c10" },
      { token: "comment", foreground: "6a737d", fontStyle: "italic" },
      { token: "keyword", foreground: "0099ff" },
      { token: "string", foreground: "4cd48a" },
      { token: "number", foreground: "ffb454" },
      { token: "type", foreground: "7fd3ff" },
      { token: "delimiter", foreground: "98a2ad" },
      { token: "operator", foreground: "98a2ad" },
    ],
    colors: {
      "editor.background": "#0a0c10",
      "editor.foreground": "#e6e9ed",
      "editorGutter.background": "#0a0c10",
      "editorLineNumber.foreground": "#3b444f",
      "editorLineNumber.activeForeground": "#98a2ad",
      "editor.lineHighlightBackground": "#141920",
      "editor.selectionBackground": "#0099ff33",
      "editor.inactiveSelectionBackground": "#0099ff1f",
      "editorCursor.foreground": "#0099ff",
      "editorIndentGuide.background1": "#1c222a",
      "editorIndentGuide.activeBackground1": "#333c47",
      "editorWidget.background": "#141920",
      "editorWidget.border": "#232a33",
      "editorSuggestWidget.background": "#141920",
      "editorSuggestWidget.border": "#232a33",
      "editorSuggestWidget.selectedBackground": "#1a2028",
      "editorBracketMatch.background": "#0099ff1f",
      "editorBracketMatch.border": "#0099ff",
      // Without these, bracket-pair colourisation falls back to the vs-dark
      // defaults (gold and friends) and the palette stops being deliberate.
      "editorBracketHighlight.foreground1": "#0099ff",
      "editorBracketHighlight.foreground2": "#4cd48a",
      "editorBracketHighlight.foreground3": "#ffb454",
      "editorBracketHighlight.foreground4": "#7fd3ff",
      "editorBracketHighlight.foreground5": "#98a2ad",
      "editorBracketHighlight.foreground6": "#6a737d",
      "editorBracketHighlight.unexpectedBracket.foreground": "#ff6b6b",
      "scrollbarSlider.background": "#333c4777",
      "scrollbarSlider.hoverBackground": "#333c47aa",
      "scrollbarSlider.activeBackground": "#333c47",
    },
  });
}

function EditorLoading() {
  return (
    <div className="flex h-full items-center justify-center font-mono text-sm text-fg-subtle">
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
