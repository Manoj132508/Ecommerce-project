import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SectionNav } from "@/components/layout/SectionNav";
import { requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false, follow: false } };

/**
 * Admin area. The role is checked on the server for every request (here and
 * again in each page, because a layout is not re-rendered on client
 * navigation); Express enforces adminOnly on every admin API call. No
 * loading.tsx: redirects and 404s must be real status codes.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin("/admin");
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-4 py-3 text-sm">
        <p><span className="font-semibold">Store administration</span><span className="text-muted-foreground"> · signed in as {admin.name}</span></p>
        <p className="text-muted-foreground">Changes here apply to the live store.</p>
      </div>
      <SectionNav
        label="Admin sections"
        items={[
          { href: "/admin", label: "Dashboard" },
          { href: "/admin/products", label: "Products", matchChildren: true },
          { href: "/admin/orders", label: "Orders", matchChildren: true },
        ]}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
