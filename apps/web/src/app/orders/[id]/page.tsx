import type { Metadata } from "next";
import { NarrowContent } from "@/components/layout/Container";
import { notFound, redirect } from "next/navigation";
import { OrderDetailsClient } from "@/features/orders/OrderDetailsClient";
import { PRODUCT_ID } from "@/features/catalog/product";
import { getServerOrder } from "@/lib/server/orders";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };

export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!PRODUCT_ID.test(id)) notFound();
  const result = await getServerOrder(id);
  if (result.kind === "signed-out") redirect(`/login?from=${encodeURIComponent(`/orders/${id}`)}`);
  if (result.kind === "not-found") notFound();
  return <NarrowContent><OrderDetailsClient initialOrder={result.order} /></NarrowContent>;
}
