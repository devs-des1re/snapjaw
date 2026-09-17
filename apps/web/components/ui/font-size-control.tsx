"use client";

import { Icon } from "@iconify/react";
import minusIcon from "@iconify-icons/lucide/minus";
import plusIcon from "@iconify-icons/lucide/plus";

import { Button } from "@/components/ui/button";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/project";

export interface FontSizeControlProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}

export function FontSizeControl({
  value,
  onChange,
  min = MIN_FONT_SIZE,
  max = MAX_FONT_SIZE,
}: FontSizeControlProps) {
  return (
    <div
      role="group"
      aria-label="Editor font size"
      className="hidden items-center rounded-md border border-line bg-surface sm:flex"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label="Decrease editor font size"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className="rounded-r-none px-1.5"
      >
        <Icon icon={minusIcon} aria-hidden="true" className="size-3.5" />
      </Button>

      <span
        aria-live="polite"
        aria-atomic="true"
        className="min-w-9 text-center text-2xs text-fg-muted tabular-nums"
      >
        {value}px
      </span>

      <Button
        variant="ghost"
        size="sm"
        aria-label="Increase editor font size"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className="rounded-l-none px-1.5"
      >
        <Icon icon={plusIcon} aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}
