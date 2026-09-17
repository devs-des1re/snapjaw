import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface MenubarProps {
  wordmark: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

// Plain header semantics for the bar itself; the menus inside are a real
// menubar role with their own arrow-key handling.
export function Menubar({ wordmark, children, actions, className }: MenubarProps) {
  return (
    <header
      className={cn(
        "flex h-menubar shrink-0 items-center gap-1 border-b border-line bg-surface px-2 sm:gap-2 sm:px-3",
        className,
      )}
    >
      {wordmark}
      {children}
      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">{actions}</div>
    </header>
  );
}
