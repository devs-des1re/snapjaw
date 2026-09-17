"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import checkIcon from "@iconify-icons/lucide/check";
import copyIcon from "@iconify-icons/lucide/copy";
import xIcon from "@iconify-icons/lucide/x";

import { Button } from "@/components/ui/button";

export const SHARE_URL_INPUT_ID = "snapjaw-share-url";

export type ShareState =
  | { status: "idle" }
  | { status: "sharing" }
  | { status: "shared"; url: string }
  | { status: "error"; message: string };

export interface ShareBarProps {
  state: ShareState;
  onDismiss: () => void;
}

type CopyState = "idle" | "copied" | "manual";

export function ShareBar({ state, onDismiss }: ShareBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const url = state.status === "shared" ? state.url : null;

  // copyState resets on its own because the parent keys this component by share state.
  useEffect(() => {
    if (!url) return;
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, [url]);

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  const handleCopy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      inputRef.current?.select();
      setCopyState("manual");
    }
  }, [url]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    },
    [onDismiss],
  );

  if (state.status === "idle") return null;

  return (
    <section
      aria-label="Share link"
      onKeyDown={handleKeyDown}
      className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-2 py-1.5 sm:px-3"
    >
      {state.status === "sharing" ? (
        <p role="status" className="p-0.5 text-2xs text-fg-muted">
          Creating link…
        </p>
      ) : null}

      {state.status === "error" ? (
        <>
          <p
            role="alert"
            title={state.message}
            className="min-w-0 flex-1 truncate text-2xs text-danger"
          >
            {state.message}
          </p>
          <Button size="sm" variant="ghost" aria-label="Dismiss share error" onClick={onDismiss}>
            <Icon icon={xIcon} aria-hidden="true" className="size-3.5" />
          </Button>
        </>
      ) : null}

      {state.status === "shared" ? (
        <>
          <label
            htmlFor={SHARE_URL_INPUT_ID}
            className="hidden shrink-0 text-2xs font-medium text-fg-muted sm:block"
          >
            Share link
          </label>

          <input
            id={SHARE_URL_INPUT_ID}
            ref={inputRef}
            readOnly
            value={state.url}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs text-fg outline-none focus:border-focus"
          />

          <Button
            size="sm"
            variant="secondary"
            onClick={handleCopy}
            aria-label={copyState === "copied" ? "Share link copied" : "Copy share link"}
          >
            <Icon
              icon={copyState === "copied" ? checkIcon : copyIcon}
              aria-hidden="true"
              className="size-3.5"
            />
            <span className="hidden sm:inline">{copyState === "copied" ? "Copied" : "Copy"}</span>
          </Button>

          <Button size="sm" variant="ghost" aria-label="Dismiss share link" onClick={onDismiss}>
            <Icon icon={xIcon} aria-hidden="true" className="size-3.5" />
          </Button>

          <p aria-live="polite" className="sr-only">
            {copyState === "copied"
              ? "Share link copied to the clipboard."
              : "Share link ready and selected."}
          </p>
        </>
      ) : null}
    </section>
  );
}
