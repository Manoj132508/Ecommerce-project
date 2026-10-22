"use client";

import Link from "next/link";
import { OrderCard } from "./OrderCard";
import { useOrdersQuery } from "./hooks";

export function OrdersPageClient() {
  const orders = useOrdersQuery();
  if (orders.isPending) return <p aria-live="polite">Loading your orders…</p>;
  if (orders.isError) return <div role="alert"><p className="mb-3 text-red-700">{orders.error.message}</p><button className="font-semibold underline" onClick={() => void orders.refetch()}>Try again</button></div>;
  if (!orders.data?.length) {
    return (
      <section className="rounded-lg border p-8 text-center">
        <h1 className="mb-2 text-2xl font-bold">No orders yet</h1>
        <p className="mb-5 text-slate-600">Orders you place will appear here.</p>
        <Link href="/products" className="font-semibold text-[#08783e] underline">Browse products</Link>
      </section>
    );
  }
  return <div><h1 className="mb-6 text-3xl font-bold">Your orders</h1><div className="space-y-6">{orders.data.map((order) => <OrderCard key={order.id} order={order} />)}</div></div>;
}
