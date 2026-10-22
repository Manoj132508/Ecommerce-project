import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { statusLabel } from "@/features/admin/api";
import { OrderStatusForm } from "@/features/admin/OrderStatusForm";
import { formatMoney, PRODUCT_ID } from "@/features/catalog/product";
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
      <Link href="/admin/orders" className="font-semibold text-[#08783e] underline">Back to orders</Link>
      <div>
        <h1 className="text-3xl font-bold">Order {order.id.slice(0, 8)}</h1>
        <p className="break-all text-sm text-slate-600">Full ID {order.id}</p>
      </div>

      <section aria-labelledby="summary" className="grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-2 sm:p-6">
        <h2 id="summary" className="sr-only">Summary</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-slate-600">Status</dt><dd className="font-semibold">{statusLabel(order.status)}</dd>
          <dt className="text-slate-600">Placed</dt><dd>{formatOrderTime(order.orderTimeMs)}</dd>
          <dt className="text-slate-600">Order total</dt><dd className="font-semibold">{formatMoney(order.totalCostCents)}</dd>
          <dt className="text-slate-600">Account</dt><dd className="break-all">{order.userId ?? "None (legacy order)"}</dd>
        </dl>
        {order.customer ? (
          <div>
            <h3 className="font-semibold">Customer</h3>
            <address className="not-italic">{order.customer.fullName}<br />{order.customer.address}<br />{order.customer.city}, {order.customer.postalCode}<br />{order.customer.country}</address>
            <p className="break-all text-sm text-slate-600">{order.customer.email} · {order.customer.phone}</p>
          </div>
        ) : <p className="text-slate-600">No customer details were recorded for this legacy order.</p>}
        <p className="text-sm text-slate-600 sm:col-span-2">The total and the items are fixed when the order is placed and cannot be changed here. Cancelling does not refund anything; no payment provider is connected.</p>
      </section>

      <section aria-labelledby="items">
        <h2 id="items" className="mb-3 text-xl font-bold">Items</h2>
        <ul className="divide-y rounded-lg border bg-white">
          {order.products.map((line, index) => (
            <li key={`${line.productId}-${index}`} className="flex flex-wrap justify-between gap-2 p-3">
              <div>
                <p className="font-medium">{line.product?.name ?? "Product details not recorded"}</p>
                <p className="text-sm text-slate-600">Quantity {line.quantity} · delivery expected {formatDeliveryDate(line.estimatedDeliveryTimeMs)}</p>
              </div>
              {line.product && "rating" in line.product
                ? <span className="text-sm text-slate-600">Current catalogue price {formatMoney(line.product.priceCents)}</span>
                : line.product ? <span className="font-medium">{formatMoney(line.product.priceCents)} each (price when ordered)</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="change-status" className="rounded-lg border bg-white p-4 sm:p-6">
        <h2 id="change-status" className="mb-3 text-xl font-bold">Change status</h2>
        <OrderStatusForm key={`${order.status}`} order={order} />
      </section>

      <section aria-labelledby="history">
        <h2 id="history" className="mb-3 text-xl font-bold">Status history</h2>
        {history === null ? <p>The history is not available for orders stored in MongoDB.</p>
          : history.length === 0 ? <p>No status changes have been recorded for this order.</p> : (
            <ol className="grid gap-3">
              {history.map((event, index) => (
                <li key={index} className="rounded-lg border bg-white p-3">
                  <p className="font-semibold">{event.fromStatus ? `${statusLabel(event.fromStatus)} → ` : ""}{statusLabel(event.toStatus)}</p>
                  <p className="text-sm text-slate-600">{formatOrderTime(Date.parse(event.changedAt))} by {event.changedBy.name}</p>
                  <p className="mt-1">“{event.reason}”</p>
                </li>
              ))}
            </ol>
          )}
      </section>
    </div>
  );
}
