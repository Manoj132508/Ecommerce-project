import type { Metadata } from "next";
import { NarrowContent } from "@/components/layout/Container";
import { redirect } from "next/navigation";
import { CartPageClient } from "@/features/cart/CartPageClient";
import { getServerSessionUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage() {
  if (!(await getServerSessionUser())) redirect("/login?from=%2Fcart");
  return <NarrowContent><CartPageClient /></NarrowContent>;
}
