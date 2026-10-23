import { cn } from "@/lib/utils";
import type { Order } from "./api";

const LABELS: Record<NonNullable<Order["status"]>, string> = {
  placed: "Placed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const TONES: Record<NonNullable<Order["status"]>, string> = {
  placed: "border-border bg-secondary text-secondary-foreground",
  processing: "border-border bg-secondary text-secondary-foreground",
  shipped: "border-primary/30 bg-accent text-accent-foreground",
  delivered: "border-success-foreground/30 bg-success text-success-foreground",
  cancelled: "border-destructive/40 bg-destructive/5 text-destructive",
};

/** "Not recorded (older order)" for MongoDB orders, which have no status. */
export const statusLabel = (status: Order["status"]) => (status ? LABELS[status] : "Not recorded (older order)");

/** The order status as text in a coloured pill; the colour only repeats what the words say. */
export function OrderStatusBadge({ status, label = statusLabel(status), className }: {
  status: Order["status"];
  /** The admin area words a missing status differently ("Not recorded (legacy)"). */
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap", status ? TONES[status] : "border-border bg-surface text-muted-foreground", className)}>
      <span className="sr-only">Status: </span>{label}
    </span>
  );
}
