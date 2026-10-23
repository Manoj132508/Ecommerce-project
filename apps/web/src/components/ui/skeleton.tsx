import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Placeholder block with the size of the content it stands for (keeps layout shift near zero). */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-sm bg-secondary", className)} {...props} />;
}
