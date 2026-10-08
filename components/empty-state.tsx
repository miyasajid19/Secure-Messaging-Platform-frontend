/**
 * Reusable centered empty/placeholder state.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
        aria-hidden
      >
        <Icon size={26} style={{ color: "var(--color-fg-secondary)" }} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-[var(--color-fg-primary)]">
          {title}
        </p>
        {description ? (
          <p className="max-w-xs text-sm text-[var(--color-fg-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
