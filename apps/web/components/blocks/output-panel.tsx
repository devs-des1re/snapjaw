"use client";

import { useCallback, useState, type RefObject } from "react";
import { Icon } from "@iconify/react";
import checkIcon from "@iconify-icons/lucide/check";
import copyIcon from "@iconify-icons/lucide/copy";
import terminalIcon from "@iconify-icons/lucide/terminal";
import trashIcon from "@iconify-icons/lucide/trash-2";

import { LiveDisplay } from "@/components/blocks/live-display";
import { Button } from "@/components/ui/button";
import type { LiveFrame, OutputBuffer, OutputChunk, RunResult } from "@/lib/run";
import { parseTracebackFrames } from "@/lib/traceback";

export interface OutputPanelProps {
  result: RunResult | null;
  isRunning: boolean;
  entryFile: string;
  error?: string | null;
  stopped?: boolean;
  liveFrameRef?: RefObject<LiveFrame | null>;
  frameCount?: number;
  liveOutput?: OutputBuffer;
  awaitingInput?: boolean;
  inputError?: string | null;
  isSendingInput?: boolean;
  onSubmitInput?: (value: string) => void;
  onClear?: () => void;
  onJumpToLine?: (file: string, line: number) => void;
}

const EMPTY_OUTPUT: OutputBuffer = [];

function statusLine(
  result: RunResult | null,
  isRunning: boolean,
  entryFile: string,
  error: string | null | undefined,
  stopped: boolean,
  frameCount: number,
  awaitingInput: boolean,
): string {
  if (isRunning) {
    if (awaitingInput) return `waiting for input · ${entryFile}`;
    return frameCount > 0 ? `running ${entryFile} · ${frameCount} frames` : `running ${entryFile}`;
  }

  if (stopped) return "stopped";
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

// Renders stderr with any `File "...", line N` frames turned into jump-to-line buttons.
function TracebackText({
  text,
  onJumpToLine,
}: {
  text: string;
  onJumpToLine?: (file: string, line: number) => void;
}) {
  if (!onJumpToLine) return <>{text}</>;

  const frames = parseTracebackFrames(text);
  if (frames.length === 0) return <>{text}</>;

  const parts: Array<{ text: string; frame?: { file: string; line: number } }> = [];
  const pattern = /File "([^"]+)", line (\d+)/g;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match !== null) {
    const rawPath = match[1] ?? "";
    const line = Number.parseInt(match[2] ?? "", 10);
    const start = match.index;
    const end = start + match[0].length;

    parts.push({ text: text.slice(cursor, start) });

    const file = rawPath.replace(/\\/g, "/").split("/").pop() ?? "";
    if (file && Number.isFinite(line) && line > 0) {
      parts.push({ text: match[0], frame: { file, line } });
    } else {
      parts.push({ text: match[0] });
    }

    cursor = end;
    match = pattern.exec(text);
  }
  parts.push({ text: text.slice(cursor) });

  return (
    <>
      {parts.map((part, index) =>
        part.frame ? (
          <button
            key={index}
            type="button"
            onClick={() => onJumpToLine(part.frame!.file, part.frame!.line)}
            title={`Open ${part.frame.file} at line ${part.frame.line}`}
            className="cursor-pointer rounded-sm underline decoration-dotted underline-offset-2 hover:text-fg"
          >
            {part.text}
          </button>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

// The transcript, in arrival order, with the prompt line the program is blocked on
// typed straight into it. Stderr is coloured and its traceback frames are clickable.
function ProgramConsole({
  chunks,
  awaitingInput,
  inputError,
  isSendingInput,
  onSubmitInput,
  entryFile,
  onJumpToLine,
}: {
  chunks: OutputBuffer;
  awaitingInput: boolean;
  inputError?: string | null;
  isSendingInput?: boolean;
  onSubmitInput?: (value: string) => void;
  entryFile: string;
  onJumpToLine?: (file: string, line: number) => void;
}) {
  const [value, setValue] = useState("");

  const send = () => {
    if (isSendingInput) return;
    setValue("");
    onSubmitInput?.(value);
  };

  return (
    <div className="font-mono text-sm break-words whitespace-pre-wrap text-fg">
      {chunks.map((chunk, index) =>
        chunk.stream === "stderr" ? (
          <div key={index} className="text-danger">
            <TracebackText text={chunk.text} onJumpToLine={onJumpToLine} />
          </div>
        ) : (
          <span key={index}>{chunk.text}</span>
        ),
      )}
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
      {inputError ? <div className="text-danger">{inputError}</div> : null}
    </div>
  );
}

export function OutputPanel({
  result,
  isRunning,
  entryFile,
  error,
  stopped = false,
  liveFrameRef,
  frameCount = 0,
  liveOutput = EMPTY_OUTPUT,
  awaitingInput = false,
  inputError,
  isSendingInput,
  onSubmitInput,
  onClear,
  onJumpToLine,
}: OutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const transcript = liveOutput.map((chunk) => chunk.text).join("");
  const hasOutput = transcript.length > 0 || result !== null || error !== null || stopped;

  const handleCopy = useCallback(async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; nothing more to do.
    }
  }, [transcript]);

  return (
    <section aria-label="Program output" className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Icon icon={terminalIcon} aria-hidden="true" className="size-3.5 text-fg-subtle" />
        <h2 className="text-2xs font-medium tracking-wide text-fg-muted uppercase">Output</h2>

        <p aria-live="polite" className="ml-auto truncate text-2xs text-fg-subtle tabular-nums">
          {statusLine(result, isRunning, entryFile, error, stopped, frameCount, awaitingInput)}
        </p>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={copied ? "Output copied" : "Copy output"}
            title="Copy output"
            disabled={!hasOutput}
            onClick={() => void handleCopy()}
            className="px-1.5"
          >
            <Icon
              icon={copied ? checkIcon : copyIcon}
              aria-hidden="true"
              className="size-3.5"
            />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            aria-label="Clear output"
            title="Clear output"
            disabled={!hasOutput}
            onClick={onClear}
            className="px-1.5"
          >
            <Icon icon={trashIcon} aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
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
          onJumpToLine={onJumpToLine}
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
  stopped = false,
  liveFrameRef,
  frameCount = 0,
  liveOutput = EMPTY_OUTPUT,
  awaitingInput = false,
  inputError,
  isSendingInput,
  onSubmitInput,
  onJumpToLine,
}: OutputPanelProps) {
  const liveChunks = liveOutput;
  const hasTranscript = liveChunks.length > 0 || awaitingInput;

  if (isRunning) {
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
                chunks={liveChunks}
                awaitingInput={awaitingInput}
                inputError={inputError}
                isSendingInput={isSendingInput}
                onSubmitInput={onSubmitInput}
                entryFile={entryFile}
                onJumpToLine={onJumpToLine}
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
            chunks={liveChunks}
            awaitingInput={awaitingInput}
            inputError={inputError}
            isSendingInput={isSendingInput}
            onSubmitInput={onSubmitInput}
            entryFile={entryFile}
            onJumpToLine={onJumpToLine}
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

  // A stopped run has no result; the transcript is all there is to show.
  if (stopped) {
    return (
      <div className="p-3">
        <ProgramConsole
          chunks={liveChunks}
          awaitingInput={false}
          entryFile={entryFile}
          onJumpToLine={onJumpToLine}
        />
        <p className="mt-2 text-sm text-fg-subtle">Run stopped.</p>
      </div>
    );
  }

  if (!result) {
    return <p className="p-3 text-sm text-fg-subtle">Press Run to execute {entryFile}.</p>;
  }

  // The streamed chunks are ordered; the result's separate stdout/stderr is the fallback.
  const chunks: OutputChunk[] =
    liveChunks.length > 0
      ? liveChunks
      : [
          ...(result.stdout ? [{ stream: "stdout" as const, text: result.stdout }] : []),
          ...(result.stderr ? [{ stream: "stderr" as const, text: result.stderr }] : []),
        ];

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
            chunks={chunks}
            awaitingInput={false}
            entryFile={entryFile}
            onJumpToLine={onJumpToLine}
          />
        </div>
      )}
    </div>
  );
}
