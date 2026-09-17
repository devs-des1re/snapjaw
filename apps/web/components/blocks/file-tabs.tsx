"use client";

import {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Icon } from "@iconify/react";
import filePlusIcon from "@iconify-icons/lucide/file-plus";
import uploadIcon from "@iconify-icons/lucide/upload";
import xIcon from "@iconify-icons/lucide/x";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ProjectFile } from "@/lib/project";

export type RenameOutcome = { ok: true } | { ok: false; error: string };

export const EDITOR_TABPANEL_ID = "snapjaw-editor-panel";

export function fileTabId(name: string): string {
  return `snapjaw-file-tab-${name}`;
}

export interface FileTabsHandle {
  beginRename: (name: string) => void;
}

export interface FileTabsProps {
  files: readonly ProjectFile[];
  activeFile: string;
  notice: string | null;
  onSelect: (name: string) => void;
  onCreate: () => string | null;
  onOpenFiles: (files: FileList) => void;
  onRename: (from: string, to: string) => RenameOutcome;
  onClose: (name: string) => void;
  handleRef?: RefObject<FileTabsHandle | null>;
  inputRef?: RefObject<HTMLInputElement | null>;
}

interface RenameState {
  from: string;
  draft: string;
}

export function FileTabs({
  files,
  activeFile,
  notice,
  onSelect,
  onCreate,
  onOpenFiles,
  onRename,
  onClose,
  handleRef,
  inputRef,
}: FileTabsProps) {
  const [editing, setEditing] = useState<RenameState | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Refs mirror state so a commit and the blur that follows it cannot both apply.
  const editingRef = useRef<RenameState | null>(null);
  const settledRef = useRef(false);
  const tablistRef = useRef<HTMLDivElement>(null);

  const canClose = files.length > 1;

  const applyEditing = useCallback((next: RenameState | null) => {
    editingRef.current = next;
    setEditing(next);
  }, []);

  const beginRename = useCallback(
    (name: string) => {
      settledRef.current = false;
      setRenameError(null);
      applyEditing({ from: name, draft: name });
    },
    [applyEditing],
  );

  // The File menu renames a new file the same way the tab row does.
  useImperativeHandle(handleRef, () => ({ beginRename }), [beginRename]);

  const commitRename = useCallback(() => {
    if (settledRef.current) return;
    const current = editingRef.current;
    if (!current) return;

    const outcome = onRename(current.from, current.draft);
    if (!outcome.ok) {
      setRenameError(outcome.error);
      return;
    }

    settledRef.current = true;
    setRenameError(null);
    applyEditing(null);
  }, [onRename, applyEditing]);

  const cancelRename = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    setRenameError(null);
    applyEditing(null);
  }, [applyEditing]);

  const handleDraftChange = useCallback(
    (next: string) => {
      const current = editingRef.current;
      if (!current) return;
      applyEditing({ ...current, draft: next });
    },
    [applyEditing],
  );

  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitRename();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelRename();
      }
    },
    [commitRename, cancelRename],
  );

  const handleTablistKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const names = files.map((file) => file.name);
      const index = names.indexOf(activeFile);
      if (index === -1) return;

      if (event.key === "F2") {
        event.preventDefault();
        beginRename(activeFile);
        return;
      }

      let nextIndex: number;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % names.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + names.length) % names.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = names.length - 1;
      else return;

      const next = names[nextIndex];
      if (!next) return;

      event.preventDefault();
      onSelect(next);
      tablistRef.current
        ?.querySelector<HTMLButtonElement>(`#${CSS.escape(fileTabId(next))}`)
        ?.focus();
    },
    [files, activeFile, onSelect, beginRename],
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const list = event.target.files;
      if (list && list.length > 0) onOpenFiles(list);
      event.target.value = "";
    },
    [onOpenFiles],
  );

  const handleNewFile = useCallback(() => {
    const name = onCreate();
    if (name) beginRename(name);
  }, [onCreate, beginRename]);

  const message = renameError ?? notice;

  return (
    <div className="flex h-tabbar shrink-0 items-stretch border-b border-line bg-surface pr-2">
      <div className="flex shrink-0 items-center gap-2 px-3">
        <Button size="md" variant="secondary" aria-label="New file" onClick={handleNewFile}>
          <Icon icon={filePlusIcon} aria-hidden="true" className="size-4" />
          <span className="hidden md:inline">New file</span>
        </Button>

        <label
          className={cn(
            "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm",
            "border border-line-strong bg-surface text-fg transition-colors duration-100",
            "hover:bg-elevated active:bg-panel",
            "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
          )}
        >
          <Icon icon={uploadIcon} aria-hidden="true" className="size-4" />
          <span className="hidden md:inline">Open file</span>
          <input
            type="file"
            multiple
            aria-label="Open files from your computer"
            accept=".py,.txt,.md,.json,.csv,.html,.css,.js,.ts,text/*"
            ref={inputRef}
            className="sr-only"
            onChange={handleFileInputChange}
          />
        </label>
      </div>

      <div aria-hidden="true" className="my-2 w-px shrink-0 bg-line" />

      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Open files"
        onKeyDown={handleTablistKeyDown}
        className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto px-1"
      >
        {files.map((file) => {
          const isActive = file.name === activeFile;
          const isEditing = editing?.from === file.name;

          if (isEditing) {
            return (
              <div key={file.name} className="flex shrink-0 items-center">
                <input
                  autoFocus
                  aria-label={`Rename ${file.name}`}
                  value={editing.draft}
                  spellCheck={false}
                  onChange={(event) => handleDraftChange(event.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                  onFocus={(event) => event.currentTarget.select()}
                  className="my-1 w-40 rounded-md border border-focus bg-panel px-2 text-xs text-fg outline-none"
                />
              </div>
            );
          }

          return (
            <div key={file.name} className="relative flex shrink-0 items-stretch">
              <button
                type="button"
                role="tab"
                id={fileTabId(file.name)}
                aria-selected={isActive}
                aria-controls={EDITOR_TABPANEL_ID}
                tabIndex={isActive ? 0 : -1}
                title={`${file.name} — double-click or press F2 to rename`}
                onClick={() => onSelect(file.name)}
                onDoubleClick={() => beginRename(file.name)}
                className={cn(
                  "flex max-w-48 items-center truncate rounded-t-md border-b-2 px-2.5 text-xs whitespace-nowrap transition-colors",
                  canClose && "pr-6",
                  isActive
                    ? "border-fg bg-panel text-fg"
                    : "border-transparent text-fg-muted hover:bg-elevated hover:text-fg",
                )}
              >
                {file.name}
              </button>

              {canClose ? (
                <button
                  type="button"
                  aria-label={`Close ${file.name}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => onClose(file.name)}
                  className="absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-1 text-fg-subtle transition-colors hover:bg-line hover:text-fg"
                >
                  <Icon icon={xIcon} aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {message ? (
        <p
          role="status"
          className={cn(
            "max-w-64 shrink-0 self-center truncate px-2 text-2xs",
            renameError ? "text-danger" : "text-fg-muted",
          )}
          title={message}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
