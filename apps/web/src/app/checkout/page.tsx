import type { Metadata } from "next";
import { NarrowContent } from "@/components/layout/Container";
import { redirect } from "next/navigation";
import { CheckoutPageClient } from "@/features/checkout/CheckoutPageClient";
import { getServerSessionUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const user = await getServerSessionUser();
  if (!user) redirect("/login?from=%2Fcheckout");
  return <NarrowContent><CheckoutPageClient user={user} /></NarrowContent>;
}
