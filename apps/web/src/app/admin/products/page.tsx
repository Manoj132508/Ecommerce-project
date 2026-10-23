import type { Metadata } from "next";
import { AdminProductsClient } from "@/features/admin/AdminProductsClient";
import { searchParam } from "@/features/catalog/product";
import { getAdminProducts, requireAdmin } from "@/lib/server/admin";

export const metadata: Metadata = { title: "Products" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminProductsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/products");
  const params = await searchParams;
  const products = await getAdminProducts("/admin/products");
  // A confirmation after a save; the name is shown as text only.
  const saved = searchParam(params.saved);
  const name = searchParam(params.name, 120);
  const message = saved === "created" ? `${name || "The product"} was created.` : saved === "updated" ? `${name || "The product"} was saved.` : undefined;

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Products</h1>
        <p className="text-sm text-muted-foreground">The live catalogue. Changes appear in the store straight away.</p>
      </div>
      <AdminProductsClient key={message ?? "list"} products={products} saved={message} />
    </div>
  );
}
