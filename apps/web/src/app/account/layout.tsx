import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getServerSessionUser } from "@/lib/server/session";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Account area. The session is checked on the server for every request, so a
 * signed-out (or expired) visitor is sent to sign in before anything renders.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const user = await getServerSessionUser();
  if (!user) redirect("/login?from=%2Faccount");

  return (
    <div className="grid gap-6 md:grid-cols-[200px_1fr]">
      <nav aria-label="Account sections" className="flex gap-2 md:flex-col">
        <Link href="/account" className="rounded-md px-3 py-2 font-medium hover:bg-slate-100">Profile</Link>
        <Link href="/orders" className="rounded-md px-3 py-2 font-medium hover:bg-slate-100">Orders</Link>
        <Link href="/cart" className="rounded-md px-3 py-2 font-medium hover:bg-slate-100">Cart</Link>
        <Link href="/checkout" className="rounded-md px-3 py-2 font-medium hover:bg-slate-100">Checkout</Link>
      </nav>
      <section>{children}</section>
    </div>
  );
}
