"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "@iconify/react";
import checkIcon from "@iconify-icons/lucide/check";

import { cn } from "@/lib/cn";

export interface MenuItem {
  kind: "item";
  label: string;
  onSelect: () => void;
  shortcut?: string;
  disabled?: boolean;
}

export interface MenuRadio {
  kind: "radio";
  label: string;
  checked: boolean;
  onSelect: () => void;
}

export interface MenuCheckbox {
  kind: "checkbox";
  label: string;
  checked: boolean;
  onSelect: () => void;
}

export interface MenuSeparator {
  kind: "separator";
}

export type MenuEntry = MenuItem | MenuRadio | MenuCheckbox | MenuSeparator;

export interface MenuSpec {
  label: string;
  entries: MenuEntry[];
}

export interface MenuBarProps {
  menus: MenuSpec[];
  className?: string;
}

function selectedItems(container: HTMLElement | null | undefined): HTMLButtonElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)'),
  );
}

function Tick() {
  return (
    <span aria-hidden="true" className="flex w-4 shrink-0 justify-center text-fg">
      <Icon icon={checkIcon} className="size-3.5" />
    </span>
  );
}

// A real menubar: click or Enter opens a menu, arrows walk it, Escape returns
// focus to the button. Matching the ARIA pattern matters here because the top
// level buttons promise arrow-key navigation.
export function MenuBar({ menus, className }: MenuBarProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuRefs = useRef<Array<HTMLDivElement | null>>([]);

  const close = useCallback((returnFocusTo?: number) => {
    setOpenIndex(null);
    if (returnFocusTo !== undefined) buttonRefs.current[returnFocusTo]?.focus();
  }, []);

  const open = useCallback((index: number) => {
    setOpenIndex(index);
    requestAnimationFrame(() => selectedItems(menuRefs.current[index])[0]?.focus());
  }, []);

  useEffect(() => {
    if (openIndex === null) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenIndex(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openIndex]);

  const handleBarKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (openIndex === null) return;

      if (event.key === "Escape") {
        event.preventDefault();
        close(openIndex);
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = (openIndex + step + menus.length) % menus.length;
      open(next);
    },
    [openIndex, menus.length, close, open],
  );

  const handleButtonKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(index);
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = (index + step + menus.length) % menus.length;
        buttonRefs.current[next]?.focus();
        if (openIndex !== null) open(next);
      }
    },
    [menus.length, open, openIndex],
  );

  const handleMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, menuIndex: number) => {
      const items = selectedItems(menuRefs.current[menuIndex]);
      if (items.length === 0) return;

      const current = items.indexOf(document.activeElement as HTMLButtonElement);

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          items[(current + 1 + items.length) % items.length]?.focus();
          return;
        case "ArrowUp":
          event.preventDefault();
          items[(current - 1 + items.length) % items.length]?.focus();
          return;
        case "Home":
          event.preventDefault();
          items[0]?.focus();
          return;
        case "End":
          event.preventDefault();
          items[items.length - 1]?.focus();
          return;
        case "Tab":
          close();
          return;
        case "Escape":
          event.preventDefault();
          close(menuIndex);
          return;
        default:
          return;
      }
    },
    [close],
  );

  return (
    <div
      ref={barRef}
      role="menubar"
      aria-label="Application menu"
      onKeyDown={handleBarKeyDown}
      className={cn("flex items-center", className)}
    >
      {menus.map((menu, index) => {
        const isOpen = openIndex === index;

        return (
          <div key={menu.label} className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              tabIndex={isOpen || (openIndex === null && index === 0) ? 0 : -1}
              onClick={() => (isOpen ? close() : open(index))}
              onPointerEnter={() => {
                if (openIndex !== null && !isOpen) open(index);
              }}
              onKeyDown={(event) => handleButtonKeyDown(event, index)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs transition-colors",
                isOpen ? "bg-elevated text-fg" : "text-fg-muted hover:bg-elevated hover:text-fg",
              )}
            >
              {menu.label}
            </button>

            {isOpen ? (
              <div
                role="menu"
                aria-label={menu.label}
                ref={(node) => {
                  menuRefs.current[index] = node;
                }}
                onKeyDown={(event) => handleMenuKeyDown(event, index)}
                className="absolute top-full left-0 z-50 mt-1 min-w-56 rounded-lg border border-line bg-panel p-1 shadow-none"
              >
                {menu.entries.map((entry, entryIndex) => {
                  if (entry.kind === "separator") {
                    return (
                      <div
                        key={`sep-${entryIndex}`}
                        role="separator"
                        className="my-1 h-px bg-line"
                      />
                    );
                  }

                  const isChoice = entry.kind === "radio" || entry.kind === "checkbox";

                  return (
                    <button
                      key={entry.label}
                      type="button"
                      role={
                        entry.kind === "radio"
                          ? "menuitemradio"
                          : entry.kind === "checkbox"
                            ? "menuitemcheckbox"
                            : "menuitem"
                      }
                      aria-checked={isChoice ? entry.checked : undefined}
                      disabled={entry.kind === "item" ? entry.disabled : false}
                      tabIndex={-1}
                      onClick={() => {
                        entry.onSelect();
                        close(index);
                      }}
                      className={cn(
                        "flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-elevated hover:text-fg",
                        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
                      )}
                    >
                      {isChoice ? (
                        entry.checked ? (
                          <Tick />
                        ) : (
                          <span aria-hidden="true" className="w-4 shrink-0" />
                        )
                      ) : null}

                      <span className="flex-1 truncate">{entry.label}</span>

                      {entry.kind === "item" && entry.shortcut ? (
                        <span className="ml-4 shrink-0 text-2xs text-fg-subtle">
                          {entry.shortcut}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function MenuBarSpacer(): ReactNode {
  return <div aria-hidden="true" className="mx-1.5 h-4 w-px bg-line" />;
}
