"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { CartIcon, CloseIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CartLineCompact } from "./CartLine";
import { useCartQuery, useCheckoutQuery } from "./hooks";
import { OrderSummary } from "./OrderSummary";
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
  const count = items.reduce((total, item) => total + item.quantity, 0);
  const close = () => dispatch(cartDrawerClosed());

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 bg-foreground/50 motion-safe:animate-[fade-in_150ms_ease-out]" onClick={close} />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-background text-foreground shadow-lg motion-safe:animate-[slide-in-right_200ms_ease-out] sm:rounded-l-lg"
      >
        <div className="flex items-center justify-between gap-3 bg-brand px-5 py-4 text-brand-foreground [--ring:#ffffff] sm:rounded-tl-lg">
          <div>
            <h2 id="cart-drawer-title" className="text-lg font-semibold">Your cart</h2>
            {cart.isSuccess && <p className="text-sm text-white/85">{count === 0 ? "No items" : `${count} item${count === 1 ? "" : "s"}`}</p>}
          </div>
          <button ref={closeButton} type="button" onClick={close} className={buttonVariants({ variant: "inverse" })}><CloseIcon />Close</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          {cart.isPending && (
            <div role="status" aria-label="Loading your cart" className="grid gap-4 py-5">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="flex gap-3"><Skeleton className="size-16" /><div className="grid flex-1 gap-2"><Skeleton className="h-4" /><Skeleton className="h-4 w-1/2" /></div></div>
              ))}
            </div>
          )}
          {cart.isError && (
            <Alert role="alert" variant="destructive" className="my-5">
              <p>{cart.error.message}</p>
              <div><Button variant="outline" size="sm" onClick={() => void cart.refetch()} className="mt-2">Try again</Button></div>
            </Alert>
          )}
          {cart.isSuccess && items.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground"><CartIcon className="size-7" /></span>
              <p className="text-lg font-semibold">Your cart is empty.</p>
              <p className="text-sm text-muted-foreground">Products you add appear here.</p>
              <Link href="/products" onClick={close} className={cn(buttonVariants({ variant: "outline" }), "mt-2")}>Browse products</Link>
            </div>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <CartLineCompact key={item.productId} item={item} deliveryOptions={checkout.data?.deliveryOptions} onNavigate={close} />
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border bg-surface p-5">
            <OrderSummary summary={checkout.data?.paymentSummary} pending={checkout.isPending} error={checkout.error} compact>
              {invalid && <Alert variant="destructive">Remove unavailable products from your cart before checkout.</Alert>}
              <div className="grid gap-2 sm:grid-cols-2">
                <Link href="/cart" onClick={close} className={buttonVariants({ variant: "outline", size: "lg" })}>View cart</Link>
                {invalid ? (
                  <span aria-disabled="true" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "text-muted-foreground")}>Checkout blocked</span>
                ) : (
                  <Link href="/checkout" onClick={close} className={buttonVariants({ size: "lg" })}>Checkout</Link>
                )}
              </div>
            </OrderSummary>
          </div>
        )}
      </aside>
    </div>
  );
}
