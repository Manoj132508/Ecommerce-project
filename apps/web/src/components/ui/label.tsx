import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Visible field label (a native <label>; no Radix dependency is needed for this). */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}
