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
  isSharing: boolean;
}

export function TopMenuBar({
  fontSize,
  onFontSizeChange,
  onRun,
  onShare,
  isRunning,
  isSharing,
}: TopMenuBarProps) {
  const wordmark = (
    <Link
      href="/"
      className="rounded-md text-xl font-semibold tracking-tight text-fg"
      aria-label="Snapjaw home"
    >
      Snapjaw
    </Link>
  );

  return (
    <Menubar wordmark={wordmark}>
      <FontSizeControl value={fontSize} onChange={onFontSizeChange} />

      <Button
        variant="secondary"
        aria-label="Share files"
        aria-busy={isSharing}
        disabled={isSharing}
        onClick={onShare}
      >
        <Icon icon={shareIcon} aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">{isSharing ? "Sharing" : "Share"}</span>
      </Button>

      <Button
        variant="primary"
        aria-label="Run code"
        aria-busy={isRunning}
        disabled={isRunning}
        onClick={onRun}
      >
        <Icon icon={playIcon} aria-hidden="true" className="size-4" />
        {isRunning ? "Running" : "Run"}
      </Button>
    </Menubar>
  );
}
