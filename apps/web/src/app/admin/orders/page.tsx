import type { Metadata } from "next";
import Link from "next/link";
import { ORDER_STATUSES, statusLabel } from "@/features/admin/api";
import { formatMoney, searchParam } from "@/features/catalog/product";
import { formatOrderTime } from "@/lib/format";
import { getAdminOrders, requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: "Orders" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const FILTERS = [...ORDER_STATUSES, "none"] as const;

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/orders");
  const requested = searchParam((await searchParams).status);
  const filter = FILTERS.find((value) => value === requested);
  const orders = (await getAdminOrders("/admin/orders")).filter((order) => !filter || (order.status ?? "none") === filter);

  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-bold">Orders</h1>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {[undefined, ...FILTERS].map((value) => (
          <Link
            key={value ?? "all"}
            href={value ? `/admin/orders?status=${value}` : "/admin/orders"}
            aria-current={value === filter ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${value === filter ? "border-[#084f2d] bg-[#084f2d] text-white" : "hover:bg-slate-50"}`}
          >
            {value ? statusLabel(value === "none" ? null : value) : "All"}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-slate-600">{orders.length} {orders.length === 1 ? "order" : "orders"}</p>

      {orders.length === 0 ? <p className="rounded-lg border p-6 text-center">No orders in this view.</p> : (
        <ul className="divide-y rounded-lg border bg-white">
          {orders.map((order) => (
            <li key={order.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6">
              <div className="min-w-0">
                <Link href={`/admin/orders/${order.id}`} className="font-semibold text-[#08783e] underline">
                  {order.customer?.fullName ?? "Legacy order (no customer details)"}
                </Link>
                <p className="break-all text-sm text-slate-600">{order.customer?.email ?? order.id}</p>
                <p className="text-sm text-slate-600">{formatOrderTime(order.orderTimeMs)} · {order.products.length} {order.products.length === 1 ? "line" : "lines"}</p>
              </div>
              <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">{statusLabel(order.status)}</span>
              <span className="font-semibold">{formatMoney(order.totalCostCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
