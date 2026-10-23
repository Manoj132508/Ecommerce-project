"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/features/catalog/product";
import { formatOrderTime } from "@/lib/format";
import type { Order } from "./api";
import { OrderCard } from "./OrderCard";
import { useOrderQuery } from "./hooks";
import { OrderStatusBadge } from "./OrderStatus";

export function OrderDetailsClient({ initialOrder }: { initialOrder: Order }) {
  const query = useOrderQuery(initialOrder.id, initialOrder);
  const placed = useSearchParams().get("placed") === "1";
  const order = query.data ?? initialOrder;
  return (
    <div className="grid gap-6">
      {placed && (
        <Alert role="status" variant="success" className="px-5 py-4">
          <AlertTitle as="h2" className="text-lg">Order confirmed</AlertTitle>
          <p>Your order was recorded successfully. No payment was processed.</p>
        </Alert>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Order details</h1>
          <p className="text-sm text-muted-foreground">Placed {formatOrderTime(order.orderTimeMs)}</p>
          <OrderStatusBadge status={order.status} />
        </div>
        <Link href="/orders" className={buttonVariants({ variant: "outline" })}>Back to orders</Link>
      </div>
      {query.isError && <Alert role="alert" variant="destructive">The latest order status could not be refreshed.</Alert>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <OrderCard order={order} detailed />
        <div className="grid gap-6 lg:sticky lg:top-6">
          <Card className="grid gap-2 p-5">
            <h2 className="text-lg font-semibold">Order total</h2>
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(order.totalCostCents)}</p>
            <p className="text-sm text-muted-foreground">The amount recorded when the order was placed, including shipping and tax. No payment was taken.</p>
          </Card>
          {order.customer && (
            <Card className="grid gap-2 p-5">
              <h2 className="text-lg font-semibold">Delivery details</h2>
              <address className="not-italic leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                {order.customer.fullName}<br />{order.customer.address}<br />{order.customer.city}, {order.customer.postalCode}<br />{order.customer.country}
              </address>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{order.customer.email} · {order.customer.phone}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
