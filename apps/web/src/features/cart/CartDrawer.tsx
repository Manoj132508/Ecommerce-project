"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { formatMoney } from "@/features/catalog/product";
import { useCartQuery, useCheckoutQuery } from "./hooks";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { cartDrawerClosed } from "@/store/uiSlice";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function CartDrawer() {
  const open = useAppSelector((state) => state.ui.cartDrawerOpen);
  const dispatch = useAppDispatch();
  const cart = useCartQuery();
  const checkout = useCheckoutQuery(open);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Modal behaviour: focus moves in, Tab stays inside, Escape closes, the page
  // behind does not scroll, and focus returns to the control that opened it.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dispatch(cartDrawerClosed());
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [dispatch, open]);

  if (!open) return null;
  const items = cart.data ?? [];
  const invalid = items.some((item) => item.unavailable) || Boolean(checkout.data?.paymentSummary.unavailableProductIds.length);

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 bg-black/45" onClick={() => dispatch(cartDrawerClosed())} />
      <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby="cart-drawer-title" className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white text-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id="cart-drawer-title" className="text-xl font-bold">Your cart</h2>
          <button ref={closeButton} type="button" onClick={() => dispatch(cartDrawerClosed())} className="rounded px-3 py-2 font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#198754]">Close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {cart.isPending && <p>Loading your cart…</p>}
          {cart.isError && <p role="alert" className="text-red-700">{cart.error.message}</p>}
          {!cart.isPending && !cart.isError && items.length === 0 && (
            <div className="py-12 text-center">
              <p className="mb-4 text-lg font-semibold">Your cart is empty.</p>
              <Link href="/products" onClick={() => dispatch(cartDrawerClosed())} className="font-semibold text-[#08783e] underline">Browse products</Link>
            </div>
          )}
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.productId} className="border-b pb-4">
                <p className="font-semibold">{item.product?.name ?? "Product no longer available"}</p>
                <div className="mt-1 flex justify-between text-sm text-slate-600">
                  <span>Quantity: {item.quantity}</span>
                  {item.product && <span>{formatMoney(item.product.priceCents * item.quantity)}</span>}
                </div>
                {item.unavailable && <p className="mt-2 text-sm font-medium text-red-700">Remove this unavailable item before checkout.</p>}
              </li>
            ))}
          </ul>
        </div>
        {items.length > 0 && (
          <div className="border-t p-5">
            <div className="mb-4 flex justify-between text-lg font-bold">
              <span>Order total</span>
              <span>{checkout.data ? formatMoney(checkout.data.paymentSummary.totalCostCents) : "—"}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Link href="/cart" onClick={() => dispatch(cartDrawerClosed())} className="rounded border border-[#198754] px-4 py-3 text-center font-semibold text-[#08783e] hover:bg-green-50">View cart</Link>
              {invalid ? (
                <span aria-disabled="true" className="rounded bg-slate-300 px-4 py-3 text-center font-semibold text-slate-600">Checkout blocked</span>
              ) : (
                <Link href="/checkout" onClick={() => dispatch(cartDrawerClosed())} className="rounded bg-[#198754] px-4 py-3 text-center font-semibold text-white hover:bg-[#126c45]">Checkout</Link>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
