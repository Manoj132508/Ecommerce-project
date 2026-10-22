"use client";

import { useQuery } from "@tanstack/react-query";
import { productsQueryKey } from "@/lib/queryKeys";
import { fetchProductSummaries } from "./api";

const price = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Proves the same-origin /api path end to end; the real catalogue comes with page migration. */
export function CatalogPreview() {
  const products = useQuery({ queryKey: productsQueryKey, queryFn: fetchProductSummaries });

  if (products.isPending) return <p className="text-slate-500">Loading products…</p>;
  if (products.isError) return <p role="alert" className="text-red-700">{products.error.message}</p>;

  return (
    <section aria-labelledby="catalog-preview">
      <h2 id="catalog-preview" className="text-lg font-semibold">
        {products.data.length} products available
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {products.data.slice(0, 6).map((product) => (
          <li key={product.id} className="flex justify-between rounded-md border border-slate-200 px-3 py-2">
            <span>{product.name}</span>
            <span className="tabular-nums text-slate-600">{price.format(product.priceCents / 100)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
