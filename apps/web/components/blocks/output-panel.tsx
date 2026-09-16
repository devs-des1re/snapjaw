"use client";

import { Icon } from "@iconify/react";
import terminalIcon from "@iconify-icons/lucide/terminal";

import type { RunResult } from "@/lib/run";

export interface OutputPanelProps {
  result: RunResult | null;
  isRunning: boolean;
  entryFile: string;
}

function statusLine(result: RunResult | null, isRunning: boolean, entryFile: string): string {
  if (isRunning) return `running ${entryFile}`;

  if (result) {
    const parts: string[] = [];
    if (result.timedOut) parts.push("timed out");
    parts.push(`exit ${result.exitCode}`, `${result.durationMs} ms`);
    return parts.join(" · ");
  }

  return "idle";
}

export function OutputPanel({ result, isRunning, entryFile }: OutputPanelProps) {
  return (
    <section aria-label="Program output" className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Icon icon={terminalIcon} aria-hidden="true" className="size-3.5 text-fg-subtle" />
        <h2 className="text-2xs font-medium tracking-wide text-fg-muted uppercase">Output</h2>
        <p
          aria-live="polite"
          className="ml-auto truncate font-mono text-2xs text-fg-subtle tabular-nums"
        >
          {statusLine(result, isRunning, entryFile)}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <OutputBody result={result} isRunning={isRunning} entryFile={entryFile} />
      </div>
    </section>
  );
}

function OutputBody({ result, isRunning, entryFile }: OutputPanelProps) {
  if (isRunning) {
    return <p className="p-3 font-mono text-sm text-fg-muted">Running {entryFile}…</p>;
  }

  if (!result) {
    return (
      <p className="p-3 font-mono text-sm text-fg-subtle">Press Run to execute {entryFile}.</p>
    );
  }

  const isEmpty = !result.stdout && !result.stderr && !result.image;

  return (
    <div className="space-y-3 p-3">
      {result.image ? (
        <figure>
          {/* A data URL produced by the sandbox, so next/image does not apply. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.image}
            alt="Window captured from the program's virtual display"
            className="max-w-full rounded-md border border-line"
          />
          <figcaption className="mt-1.5 text-2xs text-fg-subtle">Captured display</figcaption>
        </figure>
      ) : null}

      {result.stdout ? (
        <pre className="font-mono text-sm break-words whitespace-pre-wrap text-fg">
          {result.stdout}
        </pre>
      ) : null}

      {result.stderr ? (
        <pre className="font-mono text-sm break-words whitespace-pre-wrap text-danger">
          {result.stderr}
        </pre>
      ) : null}

      {isEmpty ? (
        <p className="font-mono text-sm text-fg-subtle">Program finished with no output.</p>
      ) : null}
    </div>
  );
}
