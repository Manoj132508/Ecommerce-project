import type { Metadata } from "next";
import Link from "next/link";
import { ProductFormClient } from "@/features/admin/ProductFormClient";
import { requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  await requireAdmin("/admin/products/new");
  return (
    <div className="grid gap-6">
      <Link href="/admin/products" className="focus-ring w-fit rounded-sm text-sm font-semibold text-primary underline underline-offset-4">&larr; Back to products</Link>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Add product</h1>
      <p className="-mt-3 text-sm text-muted-foreground">The product appears in the store as soon as it is created.</p>
      <ProductFormClient />
    </div>
  );
}
