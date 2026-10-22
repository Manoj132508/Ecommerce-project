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
      <h1 className="text-3xl font-bold">Products</h1>
      <AdminProductsClient key={message ?? "list"} products={products} saved={message} />
    </div>
  );
}
