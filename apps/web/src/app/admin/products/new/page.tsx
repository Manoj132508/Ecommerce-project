import type { Metadata } from "next";
import Link from "next/link";
import { ProductFormClient } from "@/features/admin/ProductFormClient";
import { requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  await requireAdmin("/admin/products/new");
  return (
    <div className="grid gap-6">
      <Link href="/admin/products" className="font-semibold text-[#08783e] underline">Back to products</Link>
      <h1 className="text-3xl font-bold">Add product</h1>
      <ProductFormClient />
    </div>
  );
}
