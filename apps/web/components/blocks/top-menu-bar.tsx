"use client";

import Link from "next/link";
import { Icon } from "@iconify/react";
import playIcon from "@iconify-icons/lucide/play";
import shareIcon from "@iconify-icons/lucide/share-2";

import { Button } from "@/components/ui/button";
import { FontSizeControl } from "@/components/ui/font-size-control";
import { Menubar } from "@/components/ui/menubar";

export interface TopMenuBarProps {
  fontSize: number;
  onFontSizeChange: (next: number) => void;
  onRun: () => void;
  onShare: () => void;
  isRunning: boolean;
  notice: string | null;
}

export function TopMenuBar({
  fontSize,
  onFontSizeChange,
  onRun,
  onShare,
  isRunning,
  notice,
}: TopMenuBarProps) {
  const wordmark = (
    <Link
      href="/"
      className="rounded-sm text-sm font-semibold tracking-tight text-fg"
      aria-label="Snapjaw home"
    >
      Snapjaw
    </Link>
  );

  return (
    <Menubar wordmark={wordmark}>
      {notice ? (
        <p
          role="status"
          title={notice}
          className="hidden max-w-72 truncate text-2xs text-fg-muted lg:block"
        >
          {notice}
        </p>
      ) : null}

      <FontSizeControl value={fontSize} onChange={onFontSizeChange} />

      <Button variant="secondary" aria-label="Share files" onClick={onShare}>
        <Icon icon={shareIcon} aria-hidden="true" className="size-3.5" />
        <span className="hidden sm:inline">Share</span>
      </Button>

      <Button
        variant="primary"
        aria-label="Run code"
        aria-busy={isRunning}
        disabled={isRunning}
        onClick={onRun}
      >
        <Icon icon={playIcon} aria-hidden="true" className="size-3.5" />
        {isRunning ? "Running" : "Run"}
      </Button>
    </Menubar>
  );
}
