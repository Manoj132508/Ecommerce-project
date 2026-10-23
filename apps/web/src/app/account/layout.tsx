import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { NarrowContent } from "@/components/layout/Container";
import { SectionNav } from "@/components/layout/SectionNav";
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
    <NarrowContent className="grid gap-6 md:grid-cols-[200px_1fr]">
      <SectionNav
        label="Account sections"
        orientation="responsive"
        items={[
          { href: "/account", label: "Profile" },
          { href: "/orders", label: "Orders" },
          { href: "/cart", label: "Cart" },
          { href: "/checkout", label: "Checkout" },
        ]}
      />
      <section className="min-w-0">{children}</section>
    </NarrowContent>
  );
}
