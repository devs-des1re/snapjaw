import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface MenubarProps {
  wordmark: ReactNode;
  children?: ReactNode;
  className?: string;
}

// Plain header semantics, not an ARIA menubar/toolbar role: those promise arrow-key navigation.
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
