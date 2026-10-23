import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Text field. Invalid fields (aria-invalid="true") get the error colour; the message is linked by the caller. */
export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "focus-ring min-h-11 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive lg:min-h-10",
        className,
      )}
      {...props}
    />
  );
}
