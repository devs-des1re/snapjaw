"use client";

import { useEffect, useState } from "react";

import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import type { HistorySnapshot } from "@/lib/history";
import type { ProjectFile } from "@/lib/project";

export interface HistoryDialogProps {
  open: boolean;
  history: readonly HistorySnapshot[];
  onClose: () => void;
  onRestore: (files: ProjectFile[], entryFile: string) => void;
}

function projectFromSnapshot(snapshot: HistorySnapshot): { files: ProjectFile[]; entryFile: string } {
  const names = Object.keys(snapshot.files);
  const ordered = names.includes(snapshot.entryFile)
    ? [snapshot.entryFile, ...names.filter((name) => name !== snapshot.entryFile)]
    : names;
  return {
    files: ordered.map((name) => ({ name, content: snapshot.files[name] ?? "" })),
    entryFile: ordered[0] ?? "",
  };
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// The hidden feature: a scrubbable list of every snapshot captured while this project
// was being written. Reached with Ctrl/Cmd+Shift+H from the editor.
export function HistoryDialog({ open, history, onClose, onRestore }: HistoryDialogProps) {
  return (
    <Dialog open={open} title="Code history" onClose={onClose}>
      {/* Mounted only while the dialog is open, so the latest snapshot starts selected. */}
      {open ? <HistoryList history={history} onRestore={onRestore} /> : null}
    </Dialog>
  );
}

function HistoryList({
  history,
  onRestore,
}: {
  history: readonly HistorySnapshot[];
  onRestore: (files: ProjectFile[], entryFile: string) => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, history.length - 1));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => Math.min(history.length - 1, current + 1));
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [history.length]);

  const selected = history[index];
  const preview = selected ? projectFromSnapshot(selected) : null;

  if (history.length === 0 || !preview || !selected) {
    return <p className="text-fg-subtle">No history was saved with this share.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ol
        aria-label="Saved snapshots"
        className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-line bg-surface p-1"
      >
        {history.map((snapshot, snapshotIndex) => (
          <li key={`${snapshot.capturedAt}-${snapshotIndex}`}>
            <button
              type="button"
              aria-current={snapshotIndex === index}
              onClick={() => setIndex(snapshotIndex)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                snapshotIndex === index
                  ? "bg-elevated text-fg"
                  : "text-fg-muted hover:bg-elevated hover:text-fg",
              )}
            >
              <span className="tabular-nums text-fg-subtle">#{snapshotIndex + 1}</span>
              <span className="flex-1 truncate">{snapshot.entryFile}</span>
              <span className="text-2xs text-fg-subtle tabular-nums">
                {formatTime(snapshot.capturedAt)}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-2">
        <span className="text-2xs text-fg-subtle">
          {Object.keys(selected.files).length} files · snapshot {index + 1} of {history.length}
        </span>
        <button
          type="button"
          onClick={() => onRestore(preview.files, preview.entryFile)}
          className="ml-auto rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs text-fg hover:bg-elevated"
        >
          Load this version
        </button>
      </div>

      <pre className="max-h-64 overflow-auto rounded-md border border-line bg-canvas p-2 font-mono text-2xs break-words whitespace-pre-wrap text-fg">
        {preview.files.map((file) => `# ${file.name}\n${file.content}`).join("\n\n")}
      </pre>

      <p className="text-2xs text-fg-subtle">
        Use ↑/↓ to move between snapshots. Editing here will not change the shared link.
      </p>
    </div>
  );
}
