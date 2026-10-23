"use client";

import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OrderCard } from "./OrderCard";
import { useOrdersQuery } from "./hooks";

export function OrdersPageClient() {
  const orders = useOrdersQuery();
  if (orders.isPending) {
    return (
      <div role="status" aria-label="Loading your orders" className="grid gap-6">
        <Skeleton className="h-9 w-44" />
        {Array.from({ length: 2 }, (_, index) => <Skeleton key={index} className="h-56 w-full rounded-md" />)}
      </div>
    );
  }
  if (orders.isError) {
    return (
      <EmptyState role="alert" headingLevel={1} title="Your orders could not be loaded" action={<Button onClick={() => void orders.refetch()}>Try again</Button>}>
        <p>{orders.error.message}</p>
      </EmptyState>
    );
  }
  if (!orders.data?.length) {
    return (
      <EmptyState headingLevel={1} title="No orders yet" action={<Link href="/products" className={buttonVariants()}>Browse products</Link>}>
        <p>Orders you place will appear here.</p>
      </EmptyState>
    );
  }
  const count = orders.data.length;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your orders</h1>
        <p className="text-sm text-muted-foreground">{count} order{count === 1 ? "" : "s"}, newest first</p>
      </div>
      <div className="grid gap-6">{orders.data.map((order) => <OrderCard key={order.id} order={order} />)}</div>
    </div>
  );
}
