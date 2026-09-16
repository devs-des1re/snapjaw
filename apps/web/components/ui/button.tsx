"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

/**
 * Flat by design: solid background or a subtle border, never a box-shadow or
 * glow. Hover and active states are background/opacity shifts only.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg font-medium hover:bg-accent-hover active:bg-accent-active",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-elevated active:bg-panel",
  ghost: "text-fg-muted hover:bg-elevated hover:text-fg active:bg-panel",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 rounded-sm px-2 text-xs",
  md: "h-8 gap-2 rounded-md px-3 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap",
        "transition-colors duration-100",
        "select-none",
        "disabled:cursor-not-allowed disabled:opacity-45",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}
