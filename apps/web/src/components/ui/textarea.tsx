import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Multi-line text field, styled like Input (invalid state from aria-invalid; the caller links the message). */
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "focus-ring min-h-24 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
