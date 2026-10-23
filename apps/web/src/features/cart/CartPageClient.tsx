"use client";

import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CartLineRow } from "./CartLine";
import { useCartQuery, useCheckoutQuery, useRemoveCartItem, useUpdateCartItem } from "./hooks";
import { OrderSummary } from "./OrderSummary";

/** What the polite status line says about the latest change. */
function updateStatus(pending: boolean, succeeded: boolean) {
  if (pending) return "Updating your cart…";
  return succeeded ? "Your cart has been updated." : "";
}

export function CartPageClient() {
  const cart = useCartQuery();
  const checkout = useCheckoutQuery(!cart.isPending);
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const items = cart.data ?? [];
  const summary = checkout.data?.paymentSummary;
  const unavailable = items.some((item) => item.unavailable) || Boolean(summary?.unavailableProductIds.length);
  const actionError = update.error ?? remove.error;
  const busy = update.isPending || remove.isPending;
  const count = items.reduce((total, item) => total + item.quantity, 0);

  if (cart.isPending) {
    return (
      <div role="status" aria-label="Loading your cart" className="grid gap-6">
        <Skeleton className="h-9 w-48" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-64 w-full rounded-md" />
          <Skeleton className="h-64 w-full rounded-md" />
        </div>
      </div>
    );
  }
  if (cart.isError) {
    return (
      <EmptyState role="alert" headingLevel={1} title="Your cart could not be loaded" action={<Button onClick={() => void cart.refetch()}>Try again</Button>}>
        <p>{cart.error.message}</p>
      </EmptyState>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState headingLevel={1} title="Your cart is empty" action={<Link href="/products" className={buttonVariants()}>Continue shopping</Link>}>
        <p>Add a product to start an order.</p>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your cart</h1>
        <p className="text-sm text-muted-foreground">{count} item{count === 1 ? "" : "s"}</p>
      </div>

      {actionError && <Alert role="alert" variant="destructive">{actionError.message}</Alert>}
      <p role="status" className="sr-only">{updateStatus(busy, update.isSuccess || remove.isSuccess)}</p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="px-4 sm:px-6">
          <ul aria-label="Cart items" className="divide-y divide-border">
            {items.map((item) => (
              <CartLineRow
                key={item.productId}
                item={item}
                deliveryOptions={checkout.data?.deliveryOptions}
                busy={busy}
                onQuantity={(quantity) => update.mutate({ productId: item.productId, changes: { quantity } })}
                onDelivery={(deliveryOptionId) => update.mutate({ productId: item.productId, changes: { deliveryOptionId } })}
                onRemove={() => remove.mutate(item.productId)}
              />
            ))}
          </ul>
        </Card>

        <Card className="p-5 sm:p-6 lg:sticky lg:top-6">
          <OrderSummary summary={summary} pending={checkout.isPending} error={checkout.error}>
            {unavailable && <Alert role="alert" variant="destructive">Remove unavailable products before checkout.</Alert>}
            {!unavailable && summary && summary.totalItems > 0 && (
              <Link href="/checkout" className={buttonVariants({ size: "lg", className: "w-full" })}>Continue to checkout</Link>
            )}
            <Link href="/products" className={buttonVariants({ variant: "outline", className: "w-full" })}>Continue shopping</Link>
            <p className="text-xs text-muted-foreground">Totals come from the store and are checked again when you place the order.</p>
          </OrderSummary>
        </Card>
      </div>
    </div>
  );
}
