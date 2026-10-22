import type { Metadata } from "next";
import Link from "next/link";
import { dashboardStatistics, ORDER_STATUSES, statusLabel } from "@/features/admin/api";
import { formatMoney } from "@/features/catalog/product";
import { formatOrderTime } from "@/lib/format";
import { getAdminOrders, getAdminProducts, requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-2xl font-bold">{value}</dd>
      {detail && <dd className="text-sm text-slate-600">{detail}</dd>}
    </div>
  );
}

/** Live figures from the API (never cached): products, orders by status and recorded order value. */
export default async function AdminDashboardPage() {
  await requireAdmin("/admin");
  const [products, orders] = await Promise.all([getAdminProducts("/admin"), getAdminOrders("/admin")]);
  const stats = dashboardStatistics(products, orders);

  return (
    <div className="grid gap-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <section aria-labelledby="totals">
        <h2 id="totals" className="sr-only">Totals</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Products" value={String(stats.products)} detail={`${stats.categories} categories`} />
          <Stat label="Orders" value={String(stats.orders)} detail={`${stats.byStatus.cancelled} cancelled`} />
          <Stat label="Order value" value={formatMoney(stats.orderValueCents)} detail="Recorded totals, cancelled orders excluded" />
          <Stat label="Last 30 days" value={formatMoney(stats.last30Days.valueCents)} detail={`${stats.last30Days.orders} ${stats.last30Days.orders === 1 ? "order" : "orders"}`} />
        </dl>
        <p className="mt-2 text-sm text-slate-600">No payment provider is connected: values are order totals as recorded, not money received.</p>
      </section>

      <section aria-labelledby="by-status">
        <h2 id="by-status" className="mb-3 text-xl font-bold">Orders by status</h2>
        <ul className="flex flex-wrap gap-2">
          {[...ORDER_STATUSES, null].map((status) => (
            <li key={status ?? "none"}>
              <Link href={`/admin/orders?status=${status ?? "none"}`} className="inline-block rounded-full border px-3 py-1 hover:bg-slate-50">
                {statusLabel(status)}: <span className="font-semibold">{stats.byStatus[status ?? "none"]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="recent">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="recent" className="text-xl font-bold">Recent orders</h2>
          <Link href="/admin/orders" className="font-semibold text-[#08783e] underline">All orders</Link>
        </div>
        {stats.recent.length === 0 ? <p>No orders yet.</p> : (
          <ul className="divide-y rounded-lg border bg-white">
            {stats.recent.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <Link href={`/admin/orders/${order.id}`} className="font-semibold text-[#08783e] underline">{order.customer?.fullName ?? "Legacy order"}</Link>
                  <p className="text-sm text-slate-600">{formatOrderTime(order.orderTimeMs)} · {statusLabel(order.status)}</p>
                </div>
                <span className="font-semibold">{formatMoney(order.totalCostCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
