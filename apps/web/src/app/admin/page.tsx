import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dashboardStatistics, ORDER_STATUSES, statusLabel } from "@/features/admin/api";
import { categorySummaries, formatMoney } from "@/features/catalog/product";
import { OrderStatusBadge } from "@/features/orders/OrderStatus";
import { formatOrderTime } from "@/lib/format";
import { getAdminOrders, getAdminProducts, requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({ label, value, detail, href, linkLabel }: { label: string; value: string; detail: string; href?: string; linkLabel?: string }) {
  return (
    <Card className="grid content-start gap-1 p-5">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      <dd className="text-sm text-muted-foreground">{detail}</dd>
      {href && <dd><Link href={href} className="focus-ring rounded-sm text-sm font-semibold text-primary underline underline-offset-4">{linkLabel}</Link></dd>}
    </Card>
  );
}

/**
 * Live figures from the API (never cached): products and categories, orders by
 * status and the recorded order value. No payment provider is connected, so
 * nothing here is money received; no other metric is derived or estimated.
 */
export default async function AdminDashboardPage() {
  await requireAdmin("/admin");
  const [products, orders] = await Promise.all([getAdminProducts("/admin"), getAdminOrders("/admin")]);
  const stats = dashboardStatistics(products, orders);
  const categories = categorySummaries(products);

  return (
    <div className="grid gap-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Read from the store&apos;s database each time this page loads.</p>
      </div>

      <section aria-labelledby="totals" className="grid gap-3">
        <h2 id="totals" className="sr-only">Totals</h2>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Products" value={String(stats.products)} detail={`${stats.categories} ${stats.categories === 1 ? "category" : "categories"}`} href="/admin/products" linkLabel="Manage products" />
          <Stat label="Orders" value={String(stats.orders)} detail={`${stats.byStatus.cancelled} cancelled`} href="/admin/orders" linkLabel="View orders" />
          <Stat label="Recorded order value" value={formatMoney(stats.orderValueCents)} detail="Order totals as recorded; cancelled orders excluded" />
          <Stat label="Recorded in the last 30 days" value={formatMoney(stats.last30Days.valueCents)} detail={`${stats.last30Days.orders} ${stats.last30Days.orders === 1 ? "order" : "orders"}, cancelled excluded`} />
        </dl>
        <p className="text-sm text-muted-foreground">No payment provider is connected: these are order totals as recorded, not money received.</p>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="by-status" className="grid gap-3">
          <h2 id="by-status" className="text-lg font-semibold">Orders by status</h2>
          <Card className="p-2">
            <ul className="divide-y divide-border">
              {[...ORDER_STATUSES, null].map((status) => {
                const count = stats.byStatus[status ?? "none"];
                return (
                  <li key={status ?? "none"}>
                    <Link
                      href={`/admin/orders?status=${status ?? "none"}`}
                      className="focus-ring flex min-h-11 items-center justify-between gap-3 rounded-sm px-3 py-2 hover:bg-secondary"
                    >
                      <OrderStatusBadge status={status} label={statusLabel(status)} />{" "}
                      <span className="font-semibold tabular-nums">{count}{" "}<span className="sr-only">{count === 1 ? "order" : "orders"}</span></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>

        <section aria-labelledby="catalogue" className="grid gap-3">
          <h2 id="catalogue" className="text-lg font-semibold">Products by category</h2>
          {categories.length === 0 ? <Card className="p-5 text-sm text-muted-foreground">No products yet.</Card> : (
            <Card className="p-2">
              <ul className="divide-y divide-border">
                {categories.map(({ name, count }) => (
                  <li key={name} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                    <span>{name}</span>
                    <span className="font-semibold tabular-nums">{count}{" "}<span className="sr-only">{count === 1 ? "product" : "products"}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>

      <section aria-labelledby="recent" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="recent" className="text-lg font-semibold">Recent orders</h2>
          <Link href="/admin/orders" className={buttonVariants({ variant: "link", size: "sm" })}>All orders</Link>
        </div>
        {stats.recent.length === 0 ? <Card className="p-5 text-sm text-muted-foreground">No orders yet.</Card> : (
          <Table caption="The five most recent orders">
            <TableHeader>
              <TableRow><TableHead>Customer</TableHead><TableHead>Placed</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Recorded total</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {stats.recent.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link href={`/admin/orders/${order.id}`} className="focus-ring rounded-sm font-semibold text-primary underline underline-offset-4">{order.customer?.fullName ?? "Legacy order"}</Link>
                  </TableCell>
                  <TableCell label="Placed">{formatOrderTime(order.orderTimeMs)}</TableCell>
                  <TableCell label="Status"><OrderStatusBadge status={order.status} label={statusLabel(order.status)} /></TableCell>
                  <TableCell label="Recorded total" className="font-semibold tabular-nums md:text-right">{formatMoney(order.totalCostCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
