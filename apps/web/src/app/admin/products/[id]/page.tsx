import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductFormClient } from "@/features/admin/ProductFormClient";
import { PRODUCT_ID } from "@/features/catalog/product";
import { getAdminProducts, requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const from = `/admin/products/${encodeURIComponent(id)}`;
  await requireAdmin(from);
  if (!PRODUCT_ID.test(id)) notFound();
  const product = (await getAdminProducts(from)).find((item) => item.id === id);
  if (!product) notFound();

  return (
    <div className="grid gap-6">
      <Link href="/admin/products" className="focus-ring w-fit rounded-sm text-sm font-semibold text-primary underline underline-offset-4">&larr; Back to products</Link>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Edit {product.name}</h1>
      <p className="-mt-3 text-sm text-muted-foreground">Changes apply to the store immediately. Orders already placed keep the name and price they were sold with.</p>
      <ProductFormClient product={product} />
    </div>
  );
}
