import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      secondary: "bg-secondary text-secondary-foreground",
      /** Light badge on the brand header. */
      inverse: "bg-white text-brand",
    },
  },
  defaultVariants: { variant: "default" },
});

/** Small count or status label. It always carries text, never colour alone. */
export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
