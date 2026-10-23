"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireCsrfToken } from "@/features/auth/hooks";
import { ProductImage } from "@/features/catalog/ProductImage";
import { filterProducts, formatMoney, type Product } from "@/features/catalog/product";
import { deleteProduct } from "./api";

/** The catalogue for administrators: filter, edit links and a confirmed delete. */
export function AdminProductsClient({ products, saved }: { products: Product[]; saved?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<Product | null>(null);
  const [message, setMessage] = useState(saved ?? "");
  const deleted = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const visible = filterProducts(products, { query, category: "" });

  const remove = useMutation({
    mutationKey: ["admin", "delete-product"],
    mutationFn: async (product: Product) => deleteProduct(product.id, await requireCsrfToken(queryClient)),
    onSuccess: (_result, product) => {
      deleted.current = true;
      setConfirming(null);
      setMessage(`${product.name} was deleted. Existing orders keep their saved copy of it.`);
      router.refresh();
    },
  });

  // Cancel: focus goes back to that row's Delete button (the dialog's opener). After a deletion the row is gone: the filter field.
  const returnFocus = () => (deleted.current ? search.current : null);

  return (
    <div className="grid gap-4">
      {message ? <Alert role="status" variant="success">{message}</Alert> : <p role="status" className="sr-only" />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1.5 sm:w-80">
          <Label htmlFor="admin-product-search">Filter the product list</Label>
          <Input ref={search} id="admin-product-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Link href="/admin/products/new" className={buttonVariants()}>Add product</Link>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">{visible.length} of {products.length} products</p>

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface p-6 text-center text-muted-foreground">No products match “{query}”.</p>
      ) : (
        <Table caption="Products in the store">
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Search keywords</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="md:min-w-56">
                  <div className="flex items-center gap-3">
                    <div className="w-12 shrink-0 rounded-sm bg-surface p-1"><ProductImage product={product} decorative sizes="48px" /></div>
                    <span className="font-semibold">{product.name}</span>
                  </div>
                </TableCell>
                <TableCell label="Category">{product.category || "No category"}</TableCell>
                <TableCell label="Price" className="tabular-nums md:text-right">{formatMoney(product.priceCents)}</TableCell>
                <TableCell label="Stock" className="tabular-nums md:text-right">{product.stock}</TableCell>
                <TableCell label="Keywords" className="text-muted-foreground md:max-w-56">
                  <span className="[overflow-wrap:anywhere]">{product.keywords.length ? product.keywords.join(", ") : "none"}</span>
                </TableCell>
                <TableCell className="md:whitespace-nowrap">
                  <div className="flex gap-2 max-md:mt-1 md:justify-end">
                    <Link href={`/admin/products/${product.id}`} aria-label={`Edit ${product.name}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Edit</Link>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Delete ${product.name}`}
                      // Safari does not focus a clicked button; the dialog returns focus to it on close.
                      onClick={(event) => { event.currentTarget.focus(); remove.reset(); deleted.current = false; setMessage(""); setConfirming(product); }}
                      className="border-destructive text-destructive hover:bg-destructive/5"
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? `Delete ${confirming.name}?` : ""}
        confirmLabel="Delete permanently"
        pendingLabel="Deleting…"
        cancelLabel="Keep product"
        pending={remove.isPending}
        error={remove.isError ? remove.error.message : undefined}
        onConfirm={() => { if (confirming) remove.mutate(confirming); }}
        onCancel={() => { setConfirming(null); remove.reset(); }}
        returnFocusTo={returnFocus}
      >
        <p>It disappears from the store and from carts at checkout. Orders already placed keep their saved name and price. This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
