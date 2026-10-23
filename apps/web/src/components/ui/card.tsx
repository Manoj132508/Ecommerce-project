import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Bordered surface with optional header, content and footer slots (shadcn/ui Card). */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-md border border-border bg-card text-card-foreground shadow-xs", className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid gap-1.5 p-5 pb-0", className)} {...props} />;
}

/** The card's heading; `as` keeps the document outline correct where it is used. */
export function CardTitle({ className, as: Heading = "h2", ...props }: ComponentProps<"h2"> & { as?: "h2" | "h3" }) {
  return <Heading className={cn("text-base font-semibold leading-snug", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-3 p-5 pt-0", className)} {...props} />;
}
