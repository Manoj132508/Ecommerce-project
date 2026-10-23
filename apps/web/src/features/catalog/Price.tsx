import { cn } from "@/lib/utils";
import { formatMoney } from "./product";

const SIZES = {
  sm: "text-sm font-semibold",
  md: "text-lg font-semibold",
  lg: "text-3xl font-semibold tracking-tight",
} as const;

/** A price in whole cents, with tabular figures so columns of prices line up. */
export function Price({ cents, size = "md", className }: { cents: number; size?: keyof typeof SIZES; className?: string }) {
  return <p className={cn("tabular-nums text-foreground", SIZES[size], className)}>{formatMoney(cents)}</p>;
}
