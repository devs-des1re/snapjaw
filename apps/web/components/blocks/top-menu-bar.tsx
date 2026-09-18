"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@iconify/react";
import menuIcon from "@iconify-icons/lucide/menu";
import playIcon from "@iconify-icons/lucide/play";
import shareIcon from "@iconify-icons/lucide/share-2";
import squareIcon from "@iconify-icons/lucide/square";

import { Button } from "@/components/ui/button";
import { FontSizeControl } from "@/components/ui/font-size-control";
import { MenuBar, type MenuSpec } from "@/components/ui/menu";
import { MenuSheet } from "@/components/ui/menu-sheet";
import { Menubar } from "@/components/ui/menubar";

export interface TopMenuBarProps {
  menus: MenuSpec[];
  fontSize: number;
  onFontSizeChange: (next: number) => void;
  onRun: () => void;
  onStop: () => void;
  onShare: () => void;
  isRunning: boolean;
  isSharing: boolean;
}

export function TopMenuBar({
  menus,
  fontSize,
  onFontSizeChange,
  onRun,
  onStop,
  onShare,
  isRunning,
  isSharing,
}: TopMenuBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const wordmark = (
    <Link
      href="/"
      className="mr-1 flex items-center gap-2 rounded-md text-xl font-semibold tracking-tight text-fg"
      aria-label="Snapjaw home"
    >
      <Image
        src="/logo.png"
        alt=""
        width={28}
        height={28}
        priority
        className="size-7 shrink-0 object-contain"
      />
      Snapjaw
    </Link>
  );

  const actions = (
    <>
      <FontSizeControl value={fontSize} onChange={onFontSizeChange} />

      <Button
        variant="secondary"
        size="md"
        aria-label="Share files"
        aria-busy={isSharing}
        disabled={isSharing}
        onClick={onShare}
        className="px-2.5 sm:px-4"
      >
        <Icon icon={shareIcon} aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">{isSharing ? "Sharing" : "Share"}</span>
      </Button>

      {isRunning ? (
        <Button
          variant="danger"
          size="md"
          aria-label="Stop the running program"
          onClick={onStop}
          className="px-2.5 sm:px-4"
        >
          <Icon icon={squareIcon} aria-hidden="true" className="size-3.5" />
          <span className="hidden sm:inline">Stop</span>
        </Button>
      ) : (
        <Button
          variant="success"
          size="md"
          aria-label="Run code"
          onClick={onRun}
          className="px-2.5 sm:px-4"
        >
          <Icon icon={playIcon} aria-hidden="true" className="size-4" />
          Run
        </Button>
      )}

      <Button
        variant="secondary"
        size="md"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(true)}
        className="px-2.5 sm:hidden"
      >
        <Icon icon={menuIcon} aria-hidden="true" className="size-4" />
      </Button>
    </>
  );

  return (
    <>
      <Menubar wordmark={wordmark} actions={actions}>
        <div aria-hidden="true" className="mx-1 hidden h-4 w-px bg-line sm:block" />
        <MenuBar menus={menus} className="hidden sm:flex" />
      </Menubar>

      <MenuSheet
        open={menuOpen}
        menus={menus}
        onClose={() => setMenuOpen(false)}
        footer={
          <FontSizeControl value={fontSize} onChange={onFontSizeChange} className="flex sm:hidden" />
        }
      />
    </>
  );
}
