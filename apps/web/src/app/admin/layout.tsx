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
  await requireAdmin("/admin");
  return (
    <div className="grid gap-6">
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
