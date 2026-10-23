import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Data table (shadcn/ui Table structure) that stays one table at every width:
 * from md it is a normal table; below md each row becomes a card and each
 * cell shows its column name. Explicit ARIA roles keep the table semantics
 * when the display changes (some browsers drop them otherwise), and the
 * header row stays available to screen readers while hidden visually.
 */

export function Table({ className, caption, children, ...props }: ComponentProps<"table"> & { caption: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card shadow-xs">
      <table role="table" className={cn("w-full border-collapse text-sm max-md:block", className)} {...props}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead role="rowgroup" className={cn("border-b border-border bg-surface text-left max-md:sr-only", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody role="rowgroup" className={cn("divide-y divide-border max-md:block", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr role="row" className={cn("align-top max-md:grid max-md:gap-2 max-md:p-4", className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return <th role="columnheader" scope="col" className={cn("px-4 py-3 font-semibold text-muted-foreground", className)} {...props} />;
}

/** `label` repeats the column name on small screens, where the header row is hidden. */
export function TableCell({ className, label, children, ...props }: ComponentProps<"td"> & { label?: string; children?: ReactNode }) {
  return (
    <td role="cell" className={cn("px-4 py-3 max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-2 max-md:p-0", className)} {...props}>
      {label && <span aria-hidden="true" className="text-xs font-medium text-muted-foreground md:hidden">{label}</span>}
      {children}
    </td>
  );
}
