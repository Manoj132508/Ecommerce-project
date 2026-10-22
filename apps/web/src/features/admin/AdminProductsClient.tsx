"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { requireCsrfToken } from "@/features/auth/hooks";
import { ProductImage } from "@/features/catalog/ProductImage";
import { filterProducts, formatMoney, type Product } from "@/features/catalog/product";
import { deleteProduct } from "./api";

/** The catalogue for administrators: search, edit links and a confirmed delete. */
export function AdminProductsClient({ products, saved }: { products: Product[]; saved?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<Product | null>(null);
  const [message, setMessage] = useState(saved ?? "");
  const confirmButton = useRef<HTMLButtonElement>(null);
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const visible = filterProducts(products, { query, category: "" });

  useEffect(() => { if (confirming) confirmButton.current?.focus(); }, [confirming]);

  const remove = useMutation({
    mutationKey: ["admin", "delete-product"],
    mutationFn: async (product: Product) => deleteProduct(product.id, await requireCsrfToken(queryClient)),
    onSuccess: (_result, product) => {
      setConfirming(null);
      setMessage(`${product.name} was deleted. Existing orders keep their saved copy of it.`);
      router.refresh();
    },
  });

  const cancel = () => {
    const id = confirming?.id;
    setConfirming(null);
    remove.reset();
    if (id) deleteButtons.current.get(id)?.focus();
  };

  return (
    <div className="grid gap-4">
      <p role="status" className={message ? "rounded border border-green-300 bg-green-50 p-3 text-green-900" : "sr-only"}>{message}</p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-80">
          <label htmlFor="admin-product-search" className="font-medium">Filter the product list</label>
          <input
            id="admin-product-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#198754]"
          />
        </div>
        <Link href="/admin/products/new" className="rounded bg-[#198754] px-5 py-2 text-center font-semibold text-white hover:bg-[#126c45]">Add product</Link>
      </div>
      <p className="text-sm text-slate-600" aria-live="polite">{visible.length} of {products.length} products</p>

      {confirming && (
        <div role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-text" className="rounded-lg border border-red-300 bg-red-50 p-4">
          <h2 id="delete-title" className="font-bold text-red-900">Delete {confirming.name}?</h2>
          <p id="delete-text" className="mb-3 text-red-900">
            It disappears from the store and from carts at checkout. Orders already placed keep their saved name and price. This cannot be undone.
          </p>
          {remove.isError && <p role="alert" className="mb-3 font-medium text-red-800">{remove.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <button ref={confirmButton} type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirming)} className="rounded bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 disabled:opacity-60">
              {remove.isPending ? "Deleting…" : "Delete permanently"}
            </button>
            <button type="button" onClick={cancel} className="rounded border border-slate-400 bg-white px-4 py-2 font-semibold hover:bg-slate-50">Keep product</button>
          </div>
        </div>
      )}

      <ul className="divide-y rounded-lg border bg-white" aria-label="Products">
        {visible.map((product) => (
          <li key={product.id} className="grid gap-3 p-4 sm:grid-cols-[64px_1fr_auto] sm:items-center">
            <ProductImage product={product} sizes="64px" className="w-16" />
            <div className="min-w-0">
              <h2 className="font-semibold">{product.name}</h2>
              <p className="text-sm text-slate-600">{product.category || "No category"} · {formatMoney(product.priceCents)} · Stock {product.stock}</p>
              <p className="truncate text-sm text-slate-600">Keywords: {product.keywords.length ? product.keywords.join(", ") : "none"}</p>
            </div>
            <div className="flex gap-2">
              <Link href={`/admin/products/${product.id}`} aria-label={`Edit ${product.name}`} className="rounded border border-[#198754] px-3 py-2 font-semibold text-[#08783e] hover:bg-green-50">Edit</Link>
              <button
                ref={(element) => { if (element) deleteButtons.current.set(product.id, element); else deleteButtons.current.delete(product.id); }}
                type="button"
                aria-label={`Delete ${product.name}`}
                onClick={() => { remove.reset(); setMessage(""); setConfirming(product); }}
                className="rounded border border-red-700 px-3 py-2 font-semibold text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="p-4 text-center">No products match “{query}”.</p>}
    </div>
  );
}
