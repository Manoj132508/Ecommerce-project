import type { Order } from "./api";

export const TRACKING_STAGES = ["Preparing", "Shipped", "Delivered"] as const;
export type TrackingStage = (typeof TRACKING_STAGES)[number];

export type Tracking =
  | { cancelled: true }
  | { cancelled: false; stage: TrackingStage; percent: number };

/**
 * Package progress as the Vite tracking page showed it: shipped after the
 * first third of the delivery window, delivered at the estimated time, and a
 * bar of at least 5 %. A status recorded by an administrator (PostgreSQL
 * orders) takes precedence when it is further along, and cancelled orders
 * show no progress.
 */
export function trackPackage(order: Pick<Order, "orderTimeMs" | "status">, deliveryTimeMs: number, now = Date.now()): Tracking {
  if (order.status === "cancelled") return { cancelled: true };
  const span = Math.max(1, deliveryTimeMs - order.orderTimeMs);
  const shippingTime = order.orderTimeMs + span / 3;
  const byTime: TrackingStage = now >= deliveryTimeMs ? "Delivered" : now >= shippingTime ? "Shipped" : "Preparing";
  const recorded: TrackingStage | null = order.status === "delivered" ? "Delivered" : order.status === "shipped" ? "Shipped" : null;
  const stage = recorded && TRACKING_STAGES.indexOf(recorded) > TRACKING_STAGES.indexOf(byTime) ? recorded : byTime;
  const timePercent = Math.min(100, Math.max(5, ((now - order.orderTimeMs) / span) * 100));
  const percent = stage === "Delivered" ? 100 : stage === "Shipped" ? Math.max(timePercent, 100 / 3) : timePercent;
  return { cancelled: false, stage, percent: Math.round(percent) };
}
