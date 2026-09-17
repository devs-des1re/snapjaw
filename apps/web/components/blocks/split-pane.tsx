"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";

export interface SplitPaneProps {
  first: ReactNode;
  second: ReactNode;
  /** Which way the divide runs: side-by-side splits left/right, stacked splits top/bottom. */
  orientation: "side-by-side" | "stacked";
  initialSize?: number;
  minSize?: number;
  maxSize?: number;
}

// Two panels with a divider that can be dragged, or moved with the arrow keys.
// Remount it (via a key) to reset the split, for example when the orientation changes.
export function SplitPane({
  first,
  second,
  orientation,
  initialSize = 62,
  minSize = 20,
  maxSize = 85,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ x: 0, y: 0, size: initialSize });
  const [size, setSize] = useState(initialSize);
  const [dragging, setDragging] = useState(false);

  const sideBySide = orientation === "side-by-side";

  const clamp = useCallback(
    (value: number) => Math.min(maxSize, Math.max(minSize, value)),
    [minSize, maxSize],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, size };
      setDragging(true);
    },
    [size],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const extent = sideBySide ? rect.width : rect.height;
      if (extent <= 0) return;

      const { x, y, size: startSize } = dragRef.current;
      const travelled = sideBySide ? event.clientX - x : event.clientY - y;
      setSize(clamp(startSize + (travelled / extent) * 100));
    },
    [dragging, sideBySide, clamp],
  );

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 10 : 2;
      const shrink = sideBySide ? "ArrowLeft" : "ArrowUp";
      const grow = sideBySide ? "ArrowRight" : "ArrowDown";

      if (event.key === shrink) setSize((current) => clamp(current - step));
      else if (event.key === grow) setSize((current) => clamp(current + step));
      else return;

      event.preventDefault();
    },
    [sideBySide, clamp],
  );

  return (
    <div
      ref={containerRef}
      className={cn("flex min-h-0 flex-1", sideBySide ? "flex-row" : "flex-col")}
    >
      <div className="min-h-0 min-w-0 shrink-0 grow-0" style={{ flexBasis: `${size}%` }}>
        {first}
      </div>

      <div
        role="separator"
        aria-orientation={sideBySide ? "vertical" : "horizontal"}
        aria-label="Resize the editor and output panels"
        aria-valuenow={Math.round(size)}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className={cn(
          "shrink-0 touch-none bg-line select-none hover:bg-line-strong",
          sideBySide ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
          dragging && "bg-line-strong",
        )}
      />

      <div className="min-h-0 min-w-0 flex-1">{second}</div>
    </div>
  );
}

// Panels do not fit side by side on a phone, so placement falls back to stacked.
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return narrow;
}
