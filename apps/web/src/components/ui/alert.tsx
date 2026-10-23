import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Notice box (shadcn/ui Alert). It has no role of its own: pass role="alert"
 * for an error that appears after an action, role="status" for a polite
 * update, and nothing for a notice that is part of the page.
 */
const alertVariants = cva("grid gap-1 rounded-md border px-4 py-3 text-sm [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-4", {
  variants: {
    variant: {
      info: "border-border bg-surface text-foreground",
      success: "border-success-foreground/30 bg-success text-success-foreground",
      warning: "border-warning-foreground/30 bg-warning text-warning-foreground",
      destructive: "border-destructive/40 bg-destructive/5 text-destructive",
    },
  },
  defaultVariants: { variant: "info" },
});

export function Alert({ className, variant, ...props }: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, as: Heading = "p", ...props }: ComponentProps<"p"> & { as?: "p" | "h2" | "h3" }) {
  return <Heading className={cn("text-base font-semibold leading-snug", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("leading-6", className)} {...props} />;
}
