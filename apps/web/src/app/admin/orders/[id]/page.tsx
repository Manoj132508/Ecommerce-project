import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { statusLabel } from "@/features/admin/api";
import { OrderStatusForm } from "@/features/admin/OrderStatusForm";
import { StatusTimeline } from "@/features/admin/StatusTimeline";
import { ProductImage } from "@/features/catalog/ProductImage";
import { formatMoney, PRODUCT_ID } from "@/features/catalog/product";
import { OrderStatusBadge } from "@/features/orders/OrderStatus";
import { formatDeliveryDate, formatOrderTime } from "@/lib/format";
import { getAdminOrder, getOrderStatusEvents, requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: "Order" };

/** One order for administrators: its fixed financial record, the status form and the audit trail. */
export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const from = `/admin/orders/${encodeURIComponent(id)}`;
  await requireAdmin(from);
  if (!PRODUCT_ID.test(id)) notFound();
  const [order, history] = await Promise.all([getAdminOrder(id, from), getOrderStatusEvents(id, from)]);
  if (!order) notFound();

  return (
    <div className="grid gap-6">
      <Link href="/admin/orders" className="focus-ring w-fit rounded-sm text-sm font-semibold text-primary underline underline-offset-4">&larr; Back to orders</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Order {order.id.slice(0, 8)}</h1>
          <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">Full ID {order.id}</p>
        </div>
        <OrderStatusBadge status={order.status} label={statusLabel(order.status)} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-6">
          <section aria-labelledby="summary">
            <Card className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
              <div className="grid content-start gap-3">
                <h2 id="summary" className="text-lg font-semibold">Order record</h2>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Placed</dt><dd>{formatOrderTime(order.orderTimeMs)}</dd>
                  <dt className="text-muted-foreground">Recorded total</dt><dd className="font-semibold tabular-nums">{formatMoney(order.totalCostCents)}</dd>
                  <dt className="text-muted-foreground">Account</dt><dd className="font-mono text-xs leading-5 [overflow-wrap:anywhere]">{order.userId ?? "None (legacy order)"}</dd>
                </dl>
              </div>
              <div className="grid content-start gap-3">
                <h3 className="text-lg font-semibold">Customer</h3>
                {order.customer ? (
                  <div className="text-sm">
                    <address className="not-italic leading-6 [overflow-wrap:anywhere]">{order.customer.fullName}<br />{order.customer.address}<br />{order.customer.city}, {order.customer.postalCode}<br />{order.customer.country}</address>
                    <p className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">{order.customer.email} · {order.customer.phone}</p>
                  </div>
                ) : <p className="text-sm text-muted-foreground">No customer details were recorded for this legacy order.</p>}
              </div>
              <Alert className="sm:col-span-2">
                The total and the items are fixed when the order is placed and cannot be changed here. Cancelling an order does not refund anything; no payment provider is connected.
              </Alert>
            </Card>
          </section>

          <section aria-labelledby="items" className="grid gap-3">
            <h2 id="items" className="text-lg font-semibold">Items</h2>
            <Card className="px-4 sm:px-6">
              <ul className="divide-y divide-border">
                {order.products.map((line, index) => (
                  <li key={`${line.productId}-${index}`} className="flex gap-4 py-4">
                    {line.product ? (
                      <div className="w-14 shrink-0 self-start rounded-sm bg-surface p-1"><ProductImage product={line.product} decorative sizes="56px" /></div>
                    ) : <div aria-hidden="true" className="aspect-square w-14 shrink-0 rounded-sm bg-secondary" />}
                    <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <div className="grid min-w-0 gap-0.5">
                        <p className="font-medium">{line.product?.name ?? "Product details not recorded"}</p>
                        <p className="text-sm text-muted-foreground">Quantity {line.quantity} · delivery expected {formatDeliveryDate(line.estimatedDeliveryTimeMs)}</p>
                      </div>
                      {line.product && "rating" in line.product
                        ? <span className="text-sm text-muted-foreground">Price paid not recorded · current catalogue price {formatMoney(line.product.priceCents)}</span>
                        : line.product ? <span className="text-sm font-medium tabular-nums">{formatMoney(line.product.priceCents)} each (price when ordered)</span>
                          : <span className="text-sm text-muted-foreground">Price not recorded</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </div>

        <div className="grid gap-6 lg:sticky lg:top-6">
          <section aria-labelledby="change-status">
            <Card className="grid gap-4 p-5 sm:p-6">
              <h2 id="change-status" className="text-lg font-semibold">Change status</h2>
              <OrderStatusForm key={`${order.status}`} order={order} />
            </Card>
          </section>

          <section aria-labelledby="history" className="grid gap-3">
            <h2 id="history" className="text-lg font-semibold">Status history</h2>
            {history === null ? <Card className="p-5 text-sm text-muted-foreground">The history is not available for orders stored in MongoDB.</Card>
              : history.length === 0 ? <Card className="p-5 text-sm text-muted-foreground">No status changes have been recorded for this order.</Card>
                : <StatusTimeline events={history} />}
          </section>
        </div>
      </div>
    </div>
  );
}
