"use client";

import { type RefObject } from "react";
import { Icon } from "@iconify/react";
import terminalIcon from "@iconify-icons/lucide/terminal";

import { LiveDisplay } from "@/components/blocks/live-display";
import type { LiveFrame, RunResult } from "@/lib/run";

export interface OutputPanelProps {
  result: RunResult | null;
  isRunning: boolean;
  entryFile: string;
  error?: string | null;
  liveFrameRef?: RefObject<LiveFrame | null>;
  frameCount?: number;
}

function statusLine(
  result: RunResult | null,
  isRunning: boolean,
  entryFile: string,
  error: string | null | undefined,
  frameCount: number,
): string {
  if (isRunning) {
    return frameCount > 0 ? `running ${entryFile} · ${frameCount} frames` : `running ${entryFile}`;
  }

  if (error) return "run failed";

  if (result) {
    const parts: string[] = [];
    if (result.timedOut) parts.push("timed out");
    parts.push(`exit ${result.exitCode}`, `${result.durationMs} ms`);
    parts.push(result.image ? "with display" : "console");
    return parts.join(" · ");
  }

  return "idle";
}

function CapturedImage({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="flex min-h-0 flex-1 flex-col gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="min-h-0 w-auto max-w-full flex-1 self-start rounded-md border border-line object-contain"
      />
      <figcaption className="shrink-0 text-2xs text-fg-subtle">{caption}</figcaption>
    </figure>
  );
}

export function OutputPanel({
  result,
  isRunning,
  entryFile,
  error,
  liveFrameRef,
  frameCount = 0,
}: OutputPanelProps) {
  return (
    <section aria-label="Program output" className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Icon icon={terminalIcon} aria-hidden="true" className="size-3.5 text-fg-subtle" />
        <h2 className="text-2xs font-medium tracking-wide text-fg-muted uppercase">Output</h2>
        <p
          aria-live="polite"
          className="ml-auto truncate font-mono text-2xs text-fg-subtle tabular-nums"
        >
          {statusLine(result, isRunning, entryFile, error, frameCount)}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <OutputBody
          result={result}
          isRunning={isRunning}
          entryFile={entryFile}
          error={error}
          liveFrameRef={liveFrameRef}
          frameCount={frameCount}
        />
      </div>
    </section>
  );
}

function OutputBody({
  result,
  isRunning,
  entryFile,
  error,
  liveFrameRef,
  frameCount = 0,
}: OutputPanelProps) {
  if (isRunning) {
    if (liveFrameRef && frameCount > 0) {
      return (
        <div className="flex h-full min-h-0 flex-col p-3">
          <figure className="flex min-h-0 flex-1 flex-col gap-1.5">
            <LiveDisplay
              frameRef={liveFrameRef}
              className="min-h-0 w-auto max-w-full flex-1 self-start rounded-md border border-line object-contain"
            />
            <figcaption className="shrink-0 text-2xs text-fg-subtle">
              Live · {frameCount} frames
            </figcaption>
          </figure>
        </div>
      );
    }

    return <p className="p-3 font-mono text-sm text-fg-muted">Running {entryFile}…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="p-3 font-mono text-sm break-words whitespace-pre-wrap text-danger">
        {error}
      </p>
    );
  }

  if (!result) {
    return (
      <p className="p-3 font-mono text-sm text-fg-subtle">Press Run to execute {entryFile}.</p>
    );
  }

  const isEmpty = !result.stdout && !result.stderr && !result.image;

  if (result.image) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        <CapturedImage
          src={result.image}
          alt="Window captured from the program's virtual display"
          caption="Captured display"
        />

        {result.stdout ? (
          <pre className="shrink-0 font-mono text-sm break-words whitespace-pre-wrap text-fg">
            {result.stdout}
          </pre>
        ) : null}

        {result.stderr ? (
          <pre className="shrink-0 font-mono text-sm break-words whitespace-pre-wrap text-danger">
            {result.stderr}
          </pre>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
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
