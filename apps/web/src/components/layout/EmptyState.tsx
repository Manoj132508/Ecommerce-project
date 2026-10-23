import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Empty, error and not-found messages: a heading, an explanation and an
 * optional action, centred in a quiet panel.
 */
export function EmptyState({ title, children, action, headingLevel = 2, role, className }: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  headingLevel?: 1 | 2;
  role?: "alert" | "status";
  className?: string;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div role={role} className={cn("flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface px-6 py-12 text-center", className)}>
      <Heading className="text-xl font-semibold">{title}</Heading>
      {children && <div className="max-w-md text-muted-foreground">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
