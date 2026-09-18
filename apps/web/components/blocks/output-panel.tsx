"use client";

import { useState, type RefObject } from "react";
import { Icon } from "@iconify/react";
import terminalIcon from "@iconify-icons/lucide/terminal";

import { LiveDisplay } from "@/components/blocks/live-display";
import type { LiveFrame, OutputBuffer, RunResult } from "@/lib/run";

export interface OutputPanelProps {
  result: RunResult | null;
  isRunning: boolean;
  entryFile: string;
  error?: string | null;
  liveFrameRef?: RefObject<LiveFrame | null>;
  frameCount?: number;
  liveOutput?: OutputBuffer;
  awaitingInput?: boolean;
  inputError?: string | null;
  isSendingInput?: boolean;
  onSubmitInput?: (value: string) => void;
}

const EMPTY_OUTPUT: OutputBuffer = { stdout: "", stderr: "" };

function statusLine(
  result: RunResult | null,
  isRunning: boolean,
  entryFile: string,
  error: string | null | undefined,
  frameCount: number,
  awaitingInput: boolean,
): string {
  if (isRunning) {
    if (awaitingInput) return `waiting for input · ${entryFile}`;
    return frameCount > 0 ? `running ${entryFile} · ${frameCount} frames` : `running ${entryFile}`;
  }

  if (error) return "run failed";

  if (result) {
    const parts: string[] = [];
    if (result.timedOut) parts.push("timed out");
    parts.push(`exit ${result.exitCode}`, `${result.durationMs} ms`);
    return parts.join(" · ");
  }

  return "idle";
}

function CapturedImage({ src, alt }: { src: string; alt: string }) {
  return (
    <figure className="flex min-h-0 flex-1 flex-col">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="min-h-0 w-auto max-w-full flex-1 self-start rounded-md border border-line object-contain"
      />
    </figure>
  );
}

// The transcript, with the prompt line the program is blocked on typed straight into it.
function ProgramConsole({
  stdout,
  stderr,
  awaitingInput,
  inputError,
  isSendingInput,
  onSubmitInput,
  entryFile,
}: {
  stdout: string;
  stderr: string;
  awaitingInput: boolean;
  inputError?: string | null;
  isSendingInput?: boolean;
  onSubmitInput?: (value: string) => void;
  entryFile: string;
}) {
  const [value, setValue] = useState("");

  const send = () => {
    if (isSendingInput) return;
    setValue("");
    onSubmitInput?.(value);
  };

  return (
    <div className="font-mono text-sm break-words whitespace-pre-wrap text-fg">
      {stdout}
      {awaitingInput ? (
        <input
          autoFocus
          aria-label={`Input for ${entryFile}`}
          value={value}
          disabled={isSendingInput}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            send();
          }}
          spellCheck={false}
          autoComplete="off"
          className="w-40 border-b border-line bg-transparent font-mono text-sm text-fg caret-fg outline-none focus:border-focus disabled:opacity-50"
        />
      ) : null}
      {stderr ? <div className="text-danger">{stderr}</div> : null}
      {inputError ? <div className="text-danger">{inputError}</div> : null}
    </div>
  );
}

export function OutputPanel({
  result,
  isRunning,
  entryFile,
  error,
  liveFrameRef,
  frameCount = 0,
  liveOutput = EMPTY_OUTPUT,
  awaitingInput = false,
  inputError,
  isSendingInput,
  onSubmitInput,
}: OutputPanelProps) {
  return (
    <section aria-label="Program output" className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Icon icon={terminalIcon} aria-hidden="true" className="size-3.5 text-fg-subtle" />
        <h2 className="text-2xs font-medium tracking-wide text-fg-muted uppercase">Output</h2>
        <p aria-live="polite" className="ml-auto truncate text-2xs text-fg-subtle tabular-nums">
          {statusLine(result, isRunning, entryFile, error, frameCount, awaitingInput)}
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
          liveOutput={liveOutput}
          awaitingInput={awaitingInput}
          inputError={inputError}
          isSendingInput={isSendingInput}
          onSubmitInput={onSubmitInput}
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
  liveOutput = EMPTY_OUTPUT,
  awaitingInput = false,
  inputError,
  isSendingInput,
  onSubmitInput,
}: OutputPanelProps) {
  const liveStdout = liveOutput.stdout;
  const liveStderr = liveOutput.stderr;

  if (isRunning) {
    const hasTranscript = liveStdout.length > 0 || liveStderr.length > 0 || awaitingInput;

    if (liveFrameRef && frameCount > 0) {
      return (
        <div className="flex h-full min-h-0 flex-col gap-3 p-3">
          <LiveDisplay
            frameRef={liveFrameRef}
            className="min-h-0 w-auto max-w-full flex-1 self-start rounded-md border border-line object-contain"
          />

          {hasTranscript ? (
            <div className="max-h-[50%] shrink-0 overflow-auto">
              <ProgramConsole
                key={`live-${isRunning}`}
                stdout={liveStdout}
                stderr={liveStderr}
                awaitingInput={awaitingInput}
                inputError={inputError}
                isSendingInput={isSendingInput}
                onSubmitInput={onSubmitInput}
                entryFile={entryFile}
              />
            </div>
          ) : null}
        </div>
      );
    }

    if (hasTranscript) {
      return (
        <div className="p-3">
          <ProgramConsole
            key={`live-${isRunning}`}
            stdout={liveStdout}
            stderr={liveStderr}
            awaitingInput={awaitingInput}
            inputError={inputError}
            isSendingInput={isSendingInput}
            onSubmitInput={onSubmitInput}
            entryFile={entryFile}
          />
        </div>
      );
    }

    return <p className="p-3 text-sm text-fg-muted">Running {entryFile}…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="p-3 text-sm break-words whitespace-pre-wrap text-danger">
        {error}
      </p>
    );
  }

  if (!result) {
    return <p className="p-3 text-sm text-fg-subtle">Press Run to execute {entryFile}.</p>;
  }

  const isEmpty = !result.stdout && !result.stderr && !result.image;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      {result.image ? (
        <CapturedImage
          src={result.image}
          alt="Window captured from the program's virtual display"
        />
      ) : null}

      {isEmpty ? (
        <p className="text-sm text-fg-subtle">Program finished with no output.</p>
      ) : (
        <div className={result.image ? "max-h-[50%] shrink-0 overflow-auto" : undefined}>
          <ProgramConsole
            stdout={result.stdout}
            stderr={result.stderr}
            awaitingInput={false}
            entryFile={entryFile}
          />
        </div>
      )}
    </div>
  );
}
