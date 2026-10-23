import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/features/catalog/product";
import { cn } from "@/lib/utils";
import type { PaymentSummary } from "./api";

/**
 * The payment summary exactly as the API computed it (GET /payment-summary):
 * nothing here is added up in the browser. One component for the cart drawer,
 * the cart page and checkout (it used to be written three times). The total is
 * the last <dd>, which the browser tests read.
 */
export function OrderSummary({ summary, pending = false, error, compact = false, children, className }: {
  summary?: PaymentSummary;
  pending?: boolean;
  error?: Error | null;
  /** Drawer: smaller type, no heading. */
  compact?: boolean;
  /** Actions and notes under the totals. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={compact ? undefined : "order-summary-title"} aria-label={compact ? "Order summary" : undefined} className={cn("flex flex-col gap-4", className)}>
      {!compact && <h2 id="order-summary-title" className="text-lg font-semibold">Order summary</h2>}
      {error ? (
        <Alert role="alert" variant="destructive">{error.message}</Alert>
      ) : pending || !summary ? (
        <div role="status" aria-label="Calculating totals" className="grid gap-3">
          {Array.from({ length: compact ? 2 : 4 }, (_, index) => <Skeleton key={index} className="h-5 w-full" />)}
        </div>
      ) : (
        <dl className={cn("grid gap-2 tabular-nums", compact ? "text-sm" : "text-base")}>
          {!compact && (
            <>
              <Row label={`Items (${summary.totalItems})`} value={formatMoney(summary.productCostCents)} />
              <Row label="Shipping" value={summary.shippingCostCents === 0 ? "Free" : formatMoney(summary.shippingCostCents)} />
              <Row label="Total before tax" value={formatMoney(summary.totalCostBeforeTaxCents)} muted />
              <Row label="Tax" value={formatMoney(summary.taxCents)} />
            </>
          )}
          {compact && <Row label={`Items (${summary.totalItems})`} value={formatMoney(summary.productCostCents)} muted />}
          <div className={cn("flex items-baseline justify-between gap-4 font-semibold", !compact && "mt-1 border-t border-border pt-3 text-lg")}>
            <dt>Order total{compact && <span className="block text-xs font-normal text-muted-foreground">Includes shipping and tax</span>}</dt>
            <dd>{formatMoney(summary.totalCostCents)}</dd>
          </div>
        </dl>
      )}
      {children}
    </section>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", muted && "text-muted-foreground")}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
