import type { Metadata } from "next";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ORDER_STATUSES, statusLabel } from "@/features/admin/api";
import { formatMoney, searchParam } from "@/features/catalog/product";
import { OrderStatusBadge } from "@/features/orders/OrderStatus";
import { formatOrderTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getAdminOrders, requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: "Orders" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const FILTERS = [...ORDER_STATUSES, "none"] as const;

/** Every order (not paginated: fine at the current volume, see MIGRATION_PLAN.md 5G), filtered by status. */
export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/orders");
  const requested = searchParam((await searchParams).status);
  const filter = FILTERS.find((value) => value === requested);
  const all = await getAdminOrders("/admin/orders");
  const orders = all.filter((order) => !filter || (order.status ?? "none") === filter);
  const count = (value: (typeof FILTERS)[number] | undefined) => (value ? all.filter((order) => (order.status ?? "none") === value).length : all.length);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Orders</h1>
        <p className="text-sm text-muted-foreground">Every customer order, newest first. Totals are as recorded when the order was placed.</p>
      </div>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {[undefined, ...FILTERS].map((value) => {
          const current = value === filter;
          return (
            <Link
              key={value ?? "all"}
              href={value ? `/admin/orders?status=${value}` : "/admin/orders"}
              aria-current={current ? "page" : undefined}
              className={cn(
                "focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm lg:min-h-9",
                current ? "border-brand bg-brand font-semibold text-brand-foreground" : "border-border bg-background hover:border-primary hover:bg-accent",
              )}
            >
              {value ? statusLabel(value === "none" ? null : value) : "All"}{" "}
              <span className="tabular-nums opacity-80">{count(value)}</span>
            </Link>
          );
        })}
      </nav>
      <p className="text-sm text-muted-foreground" role="status">{orders.length} {orders.length === 1 ? "order" : "orders"}</p>

      {orders.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface p-6 text-center text-muted-foreground">No orders in this view.</p>
      ) : (
        <Table caption={filter ? `Orders with status ${statusLabel(filter === "none" ? null : filter)}` : "All orders"}>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Placed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Recorded total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="min-w-0">
                  <div className="grid min-w-0 gap-0.5">
                    <Link href={`/admin/orders/${order.id}`} className="focus-ring w-fit rounded-sm font-semibold text-primary underline underline-offset-4">
                      {order.customer?.fullName ?? "Legacy order (no customer details)"}
                    </Link>
                    <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{order.customer?.email ?? order.id}</span>
                  </div>
                </TableCell>
                <TableCell label="Placed" className="md:whitespace-nowrap">{formatOrderTime(order.orderTimeMs)}</TableCell>
                <TableCell label="Status"><OrderStatusBadge status={order.status} label={statusLabel(order.status)} /></TableCell>
                <TableCell label="Lines" className="tabular-nums md:text-right">{order.products.length}</TableCell>
                <TableCell label="Recorded total" className="font-semibold tabular-nums md:text-right">{formatMoney(order.totalCostCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
