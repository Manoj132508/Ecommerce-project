import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The page width: at most 1280 px (P8) with the gutters from the spec
 * (16 px, 24 px from sm, 32 px from lg). Header, main and footer share it, so
 * their edges line up.
 */
export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)} {...props} />;
}

/**
 * Pages not redesigned yet (cart, checkout, orders, account, sign-in) keep the
 * 1024 px reading width they had before the container widened; Phase 6B sets
 * each page's own width.
 */
export function NarrowContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-5xl", className)} {...props} />;
}
