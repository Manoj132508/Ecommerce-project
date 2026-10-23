import type { Metadata } from "next";
import { NarrowContent } from "@/components/layout/Container";
import { redirect } from "next/navigation";
import { OrdersPageClient } from "@/features/orders/OrdersPageClient";
import { getServerSessionUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

export default async function OrdersPage() {
  if (!(await getServerSessionUser())) redirect("/login?from=%2Forders");
  return <NarrowContent><OrdersPageClient /></NarrowContent>;
}
