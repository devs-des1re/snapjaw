import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface MenubarProps {
  /** The Snapjaw text wordmark. No logo. */
  wordmark: ReactNode;
  /** Actions rendered on the trailing edge, left to right. */
  children?: ReactNode;
  className?: string;
}

/**
 * The single top bar. Plain header semantics — no ARIA menubar/toolbar role,
 * because those roles promise arrow-key navigation that a simple row of
 * buttons does not implement. Native buttons are already keyboard reachable.
 */
export function Menubar({ wordmark, children, className }: MenubarProps) {
  return (
    <header
      className={cn(
        "flex h-menubar shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:gap-3 sm:px-3",
        className,
      )}
    >
      {wordmark}
      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">{children}</div>
    </header>
  );
}
