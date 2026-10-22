import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false, follow: false } };

const linkClass = "rounded-md px-3 py-2 font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#198754]";

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
      <nav aria-label="Admin sections" className="flex flex-wrap gap-2 border-b pb-3">
        <Link href="/admin" className={linkClass}>Dashboard</Link>
        <Link href="/admin/products" className={linkClass}>Products</Link>
        <Link href="/admin/orders" className={linkClass}>Orders</Link>
      </nav>
      <div>{children}</div>
    </div>
  );
}
