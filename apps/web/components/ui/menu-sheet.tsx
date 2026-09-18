"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import checkIcon from "@iconify-icons/lucide/check";
import xIcon from "@iconify-icons/lucide/x";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { MenuEntry, MenuSpec } from "@/components/ui/menu";

export interface MenuSheetProps {
  open: boolean;
  menus: MenuSpec[];
  onClose: () => void;
  footer?: ReactNode;
}

function EntryIcon({ entry }: { entry: MenuEntry }) {
  if (entry.kind !== "radio" && entry.kind !== "checkbox") return null;

  return (
    <span aria-hidden="true" className="flex w-4 shrink-0 justify-center text-fg">
      {entry.checked ? <Icon icon={checkIcon} className="size-3.5" /> : null}
    </span>
  );
}

// The small-screen replacement for the menubar: every menu laid out as a flat list.
export function MenuSheet({ open, menus, onClose, footer }: MenuSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 flex flex-col sm:hidden">
      <div aria-hidden="true" className="flex-1 bg-black/60" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Application menu"
        className="max-h-[80dvh] overflow-y-auto rounded-t-lg border-t border-line bg-panel pb-2"
      >
        <div className="sticky top-0 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
          <span className="flex-1 text-sm font-semibold text-fg">Menu</span>
          <Button size="sm" variant="ghost" aria-label="Close menu" onClick={onClose}>
            <Icon icon={xIcon} aria-hidden="true" className="size-3.5" />
          </Button>
        </div>

        {menus.map((menu) => (
          <section key={menu.label} className="border-b border-line py-1 last:border-b-0">
            <h3 className="px-3 pt-2 pb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
              {menu.label}
            </h3>

            {menu.entries.map((entry, index) => {
              if (entry.kind === "separator") {
                return <div key={`sep-${index}`} role="separator" className="my-1 h-px bg-line" />;
              }

              const disabled = entry.kind === "item" ? entry.disabled : false;

              return (
                <button
                  key={entry.label}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    entry.onSelect();
                    onClose();
                  }}
                  className={cn(
                    "flex w-full items-center gap-1 px-3 py-2.5 text-left text-sm text-fg-muted hover:bg-elevated hover:text-fg",
                    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
                  )}
                >
                  <EntryIcon entry={entry} />
                  <span className="flex-1 truncate">{entry.label}</span>
                  {entry.kind === "item" && entry.shortcut ? (
                    <span className="ml-3 shrink-0 text-2xs text-fg-subtle">{entry.shortcut}</span>
                  ) : null}
                </button>
              );
            })}
          </section>
        ))}

        {footer ? <div className="px-3 pt-3">{footer}</div> : null}
      </div>
    </div>
  );
}
