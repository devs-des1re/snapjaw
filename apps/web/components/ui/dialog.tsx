"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import xIcon from "@iconify-icons/lucide/x";

import { Button } from "@/components/ui/button";

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

// Escape closes and focus returns to whatever opened it.
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="snapjaw-dialog-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-lg border border-line bg-panel p-4 outline-none"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 id="snapjaw-dialog-title" className="flex-1 text-sm font-semibold text-fg">
            {title}
          </h2>
          <Button size="sm" variant="ghost" aria-label="Close dialog" onClick={onClose}>
            <Icon icon={xIcon} aria-hidden="true" className="size-3.5" />
          </Button>
        </div>

        <div className="text-xs text-fg-muted">{children}</div>
      </div>
    </div>
  );
}
