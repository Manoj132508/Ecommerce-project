"use client";

import Link from "next/link";
import { ProductImage } from "@/features/catalog/ProductImage";
import { formatMoney } from "@/features/catalog/product";
import { useCartQuery, useCheckoutQuery, useRemoveCartItem, useUpdateCartItem } from "./hooks";

const quantities = Array.from({ length: 10 }, (_, index) => index + 1);
const date = (milliseconds: number) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(milliseconds);

export function CartPageClient() {
  const cart = useCartQuery();
  const checkout = useCheckoutQuery(!cart.isPending);
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const items = cart.data ?? [];
  const summary = checkout.data?.paymentSummary;
  const unavailable = items.some((item) => item.unavailable) || Boolean(summary?.unavailableProductIds.length);
  const actionError = update.error ?? remove.error;

  if (cart.isPending) return <p aria-live="polite">Loading your cart…</p>;
  if (cart.isError) return <div role="alert"><p className="mb-3 text-red-700">{cart.error.message}</p><button className="font-semibold underline" onClick={() => void cart.refetch()}>Try again</button></div>;
  if (items.length === 0) {
    return (
      <section className="rounded-lg border bg-white p-8 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-bold">Your cart is empty</h1>
        <p className="mb-6 text-slate-600">Add a product to start an order.</p>
        <Link href="/products" className="inline-block rounded bg-[#198754] px-5 py-3 font-semibold text-white hover:bg-[#126c45]">Browse products</Link>
      </section>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">Your cart</h1>
      {actionError && <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-700">{actionError.message}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_330px]">
        <section aria-label="Cart items" className="space-y-4">
          {items.map((item) => {
            const delivery = checkout.data?.deliveryOptions.find((option) => option.id === item.deliveryOptionId);
            return (
              <article key={item.productId} className={`rounded-lg border p-4 sm:p-5 ${item.unavailable ? "border-red-300 bg-red-50" : "bg-white"}`}>
                {item.product ? (
                  <div className="grid gap-5 sm:grid-cols-[120px_1fr]">
                    <ProductImage product={item.product} sizes="120px" />
                    <div>
                      <div className="flex flex-col justify-between gap-2 sm:flex-row">
                        <div><h2 className="font-bold">{item.product.name}</h2><p className="font-semibold text-[#08783e]">{formatMoney(item.product.priceCents)}</p></div>
                        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.productId)} className="self-start rounded px-2 py-1 font-semibold text-red-700 underline focus-visible:outline-2">Remove</button>
                      </div>
                      <label className="mt-4 block font-medium">Quantity
                        <select
                          value={item.quantity}
                          disabled={update.isPending}
                          onChange={(event) => update.mutate({ productId: item.productId, changes: { quantity: Number(event.target.value) } })}
                          className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 focus-visible:outline-2 focus-visible:outline-[#198754]"
                        >
                          {quantities.map((quantity) => <option key={quantity}>{quantity}</option>)}
                        </select>
                      </label>
                      {delivery && <p className="mt-3 font-semibold text-[#08783e]">Delivery: {date(delivery.estimatedDeliveryTimeMs)}</p>}
                      <fieldset className="mt-3">
                        <legend className="font-semibold">Delivery option</legend>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          {checkout.data?.deliveryOptions.map((option) => (
                            <label key={option.id} className="flex cursor-pointer gap-2 rounded border p-2 text-sm has-checked:border-[#198754] has-checked:bg-green-50">
                              <input type="radio" name={`delivery-${item.productId}`} checked={option.id === item.deliveryOptionId} disabled={update.isPending} onChange={() => update.mutate({ productId: item.productId, changes: { deliveryOptionId: option.id } })} />
                              <span>{date(option.estimatedDeliveryTimeMs)}<br />{option.priceCents ? formatMoney(option.priceCents) : "FREE"}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h2 className="font-bold text-red-800">This product is no longer available</h2>
                    <p className="my-2 text-sm text-red-700">It remains visible so nothing disappears from your cart without your action.</p>
                    <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.productId)} className="rounded bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800">Remove unavailable item</button>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <aside className="rounded-lg border bg-white p-5 shadow-sm lg:sticky lg:top-4">
          <h2 className="mb-4 text-xl font-bold">Order summary</h2>
          {checkout.isPending && <p>Calculating authoritative totals…</p>}
          {checkout.isError && <p role="alert" className="text-red-700">{checkout.error.message}</p>}
          {summary && (
            <dl className="space-y-2">
              <div className="flex justify-between"><dt>Items ({summary.totalItems})</dt><dd>{formatMoney(summary.productCostCents)}</dd></div>
              <div className="flex justify-between"><dt>Shipping</dt><dd>{formatMoney(summary.shippingCostCents)}</dd></div>
              <div className="flex justify-between"><dt>Tax</dt><dd>{formatMoney(summary.taxCents)}</dd></div>
              <div className="flex justify-between border-t pt-3 text-lg font-bold text-[#08783e]"><dt>Total</dt><dd>{formatMoney(summary.totalCostCents)}</dd></div>
            </dl>
          )}
          {unavailable && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm font-medium text-red-700">Remove unavailable products before checkout.</p>}
          {!unavailable && summary && summary.totalItems > 0 && (
            <Link href="/checkout" className="mt-5 block rounded bg-[#198754] px-4 py-3 text-center font-semibold text-white hover:bg-[#126c45]">Continue to checkout</Link>
          )}
          <Link href="/products" className="mt-3 block text-center font-semibold text-[#08783e] underline">Continue shopping</Link>
        </aside>
      </div>
    </div>
  );
}
