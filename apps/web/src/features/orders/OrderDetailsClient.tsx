"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Order } from "./api";
import { OrderCard } from "./OrderCard";
import { useOrderQuery } from "./hooks";

export function OrderDetailsClient({ initialOrder }: { initialOrder: Order }) {
  const query = useOrderQuery(initialOrder.id, initialOrder);
  const placed = useSearchParams().get("placed") === "1";
  const order = query.data ?? initialOrder;
  return (
    <div>
      {placed && (
        <div role="status" className="mb-6 rounded-lg border border-green-300 bg-green-50 p-4 text-green-900">
          <h1 className="text-xl font-bold">Order confirmed</h1>
          <p>Your order was recorded successfully. No payment was processed.</p>
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Order details</h1><p className="capitalize text-slate-600">Status: {order.status ?? "not recorded (older order)"}</p></div>
        <Link href="/orders" className="font-semibold text-[#08783e] underline">Back to orders</Link>
      </div>
      {query.isError && <p role="alert" className="mb-4 text-red-700">The latest order status could not be refreshed.</p>}
      <OrderCard order={order} detailed />
    </div>
  );
}
