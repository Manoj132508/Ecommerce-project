"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { EmptyState } from "@/components/layout/EmptyState";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionUser } from "@/features/auth/api";
import { describedBy } from "@/features/auth/fields";
import { CartLineCompact } from "@/features/cart/CartLine";
import { useCartQuery, useCheckoutQuery } from "@/features/cart/hooks";
import { OrderSummary } from "@/features/cart/OrderSummary";
import { useCreateOrder } from "@/features/orders/hooks";
import { ApiError } from "@/lib/api/client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { checkoutStepChanged } from "@/store/uiSlice";
import { CheckoutSteps } from "./CheckoutSteps";
import { CUSTOMER_FIELDS, emptyCustomer, validateCustomer, type CustomerErrors, type CustomerField } from "./customer";

/**
 * What to tell the customer when placing the order failed. The same key is
 * reused for a retry of the same details, so "try again" can never place a
 * second order.
 */
export function placeOrderMessage(error: Error): { text: string; cartLink?: boolean } {
  if (!(error instanceof ApiError)) {
    return { text: "The store could not be reached. Check your connection and try again — the order will not be placed twice. If you are unsure whether it went through, check your orders first." };
  }
  switch (error.status) {
    case 409: return { text: `${error.message} Review your cart and try again.`, cartLink: true };
    case 403: return { text: "Your session changed. Refresh the page and try again." };
    case 401: return { text: "Your session has ended. Sign in again to place the order." };
    default: return { text: error.message };
  }
}

const FIELDS: { name: CustomerField; label: string; type?: string; autoComplete: string; maxLength: number; hint?: string; wide?: boolean }[] = [
  { name: "fullName", label: "Full name", autoComplete: "name", maxLength: 100 },
  { name: "email", label: "Email", type: "email", autoComplete: "email", maxLength: 160 },
  { name: "phone", label: "Phone", type: "tel", autoComplete: "tel", maxLength: 30, hint: "Include the country code if you are outside the United Kingdom." },
  { name: "address", label: "Address", autoComplete: "street-address", maxLength: 200, hint: "House number and street.", wide: true },
  { name: "city", label: "City", autoComplete: "address-level2", maxLength: 80 },
  { name: "postalCode", label: "Postal code", autoComplete: "postal-code", maxLength: 20 },
  { name: "country", label: "Country", autoComplete: "country-name", maxLength: 80 },
];

export function CheckoutPageClient({ user }: { user: SessionUser }) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const step = useAppSelector((state) => state.ui.checkoutStep);
  const cart = useCartQuery();
  const checkout = useCheckoutQuery();
  const create = useCreateOrder();
  const [customer, setCustomer] = useState(() => emptyCustomer(user));
  const [errors, setErrors] = useState<CustomerErrors>({});
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const stepChanged = useRef(false);
  // One key per reviewed set of details: retries of the same review replay
  // safely, and changed details start a new attempt (the server refuses a key
  // reused with different details). A completed attempt has already cleared
  // the cart, so a new key can never place a second order for it.
  const attempt = useRef<{ key: string; details: string } | null>(null);
  const items = cart.data ?? [];
  const summary = checkout.data?.paymentSummary;
  const invalid = items.some((item) => item.unavailable) || Boolean(summary?.unavailableProductIds.length);

  useEffect(() => () => { dispatch(checkoutStepChanged("details")); }, [dispatch]);
  // Each step starts at its heading for keyboard and screen-reader users (not on the first render).
  useEffect(() => {
    if (stepChanged.current) stepHeading.current?.focus();
  }, [step]);

  const goTo = (next: "details" | "review") => {
    stepChanged.current = true;
    dispatch(checkoutStepChanged(next));
  };

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const name = event.currentTarget.name as CustomerField;
    const { value } = event.currentTarget;
    setCustomer((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!summary?.totalItems || invalid) return;
    const found = validateCustomer(customer);
    setErrors(found);
    const first = CUSTOMER_FIELDS.find((field) => found[field]);
    if (first) {
      document.getElementById(`checkout-${first}`)?.focus();
      return;
    }
    const details = JSON.stringify(customer);
    if (attempt.current?.details !== details) attempt.current = { key: crypto.randomUUID(), details };
    goTo("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const placeOrder = async () => {
    if (create.isPending || !attempt.current || !summary?.totalItems || invalid) return;
    try {
      const order = await create.mutateAsync({ customer, idempotencyKey: attempt.current.key });
      dispatch(checkoutStepChanged("details"));
      router.replace(`/orders/${encodeURIComponent(order.id)}?placed=1`);
    } catch {
      // TanStack Query retains the server error for the accessible alert below.
    }
  };

  if (cart.isPending || checkout.isPending) {
    return (
      <div role="status" aria-label="Loading secure checkout" className="grid gap-6">
        <Skeleton className="h-9 w-40" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-96 w-full rounded-md" />
          <Skeleton className="h-56 w-full rounded-md" />
        </div>
      </div>
    );
  }
  const loadError = cart.error ?? checkout.error;
  if (loadError) {
    return (
      <EmptyState role="alert" headingLevel={1} title="Checkout could not be loaded" action={<Button onClick={() => { void cart.refetch(); void checkout.refetch(); }}>Try again</Button>}>
        <p>{loadError.message}</p>
      </EmptyState>
    );
  }
  if (items.length === 0 || !summary?.totalItems) {
    return (
      <EmptyState headingLevel={1} title="Your cart is empty" action={<Link href="/products" className={buttonVariants({ variant: "outline" })}>Continue shopping</Link>}>
        {create.isError ? (
          // The response to an earlier attempt was lost, but the server may still have placed the order.
          <p role="status">
            Your last attempt may have completed. <Link href="/orders" className="font-semibold text-primary underline underline-offset-4">Check your orders</Link> before ordering again.
          </p>
        ) : <p>Add a product to start an order.</p>}
      </EmptyState>
    );
  }
  if (invalid) {
    return (
      <EmptyState role="alert" headingLevel={1} title="Checkout is not available yet" action={<Link href="/cart" className={buttonVariants()}>Return to your cart</Link>}>
        <p>Remove unavailable products from your cart before continuing.</p>
      </EmptyState>
    );
  }

  const failure = create.error ? placeOrderMessage(create.error) : null;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Checkout</h1>
          <p className="text-muted-foreground">Delivery details and final review</p>
        </div>
        <CheckoutSteps current={step} />
      </div>

      {failure && (
        <Alert role="alert" variant="destructive">
          <p>{failure.text}</p>
          {failure.cartLink && <p><Link href="/cart">Review your cart</Link></p>}
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {step === "details" ? (
          <Card className="p-5 sm:p-6">
            <form onSubmit={review} noValidate className="grid gap-6">
              <div>
                <h2 ref={stepHeading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">Customer and delivery details</h2>
                <p className="mt-1 text-sm text-muted-foreground">All fields are required.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELDS.map((field) => {
                  const id = `checkout-${field.name}`;
                  const error = errors[field.name];
                  return (
                    <div key={field.name} className={field.wide ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"}>
                      <Label htmlFor={id}>{field.label}</Label>
                      <Input
                        id={id}
                        name={field.name}
                        type={field.type ?? "text"}
                        value={customer[field.name]}
                        onChange={change}
                        autoComplete={field.autoComplete}
                        maxLength={field.maxLength}
                        required
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy(field.hint && `${id}-hint`, error && `${id}-error`)}
                      />
                      {field.hint && <p id={`${id}-hint`} className="text-sm text-muted-foreground">{field.hint}</p>}
                      {error && <p id={`${id}-error`} className="text-sm font-medium text-destructive">{error}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Link href="/cart" className={buttonVariants({ variant: "outline" })}>Back to cart</Link>
                <Button type="submit" size="lg">Review order</Button>
              </div>
            </form>
          </Card>
        ) : (
          <Card className="grid gap-6 p-5 sm:p-6">
            <h2 ref={stepHeading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">Final review</h2>
            <div className="grid gap-2 rounded-md bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">Deliver to</h3>
                <Button variant="link" size="sm" onClick={() => goTo("details")} className="h-auto min-h-0 p-0">
                  Change{" "}<span className="sr-only">delivery details</span>
                </Button>
              </div>
              <address className="not-italic leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                {customer.fullName}<br />{customer.address}<br />{customer.city}, {customer.postalCode}<br />{customer.country}
              </address>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{customer.email} · {customer.phone}</p>
            </div>
            <div>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">Items</h3>
                <Link href="/cart" className="focus-ring rounded-sm text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
                  Change{" "}<span className="sr-only">items in your cart</span>
                </Link>
              </div>
              <ul className="divide-y divide-border">
                {items.map((item) => <CartLineCompact key={item.productId} item={item} deliveryOptions={checkout.data?.deliveryOptions} headingLevel={4} />)}
              </ul>
            </div>
            <Alert variant="warning">
              <AlertTitle>No payment is taken</AlertTitle>
              <p>No payment provider is connected. Placing the order records it; it does not charge a card or claim payment success.</p>
            </Alert>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => goTo("details")}>Edit details</Button>
              <Button size="lg" onClick={placeOrder} disabled={create.isPending} aria-busy={create.isPending || undefined}>
                {create.isPending ? "Placing order…" : "Confirm and place order"}
              </Button>
            </div>
          </Card>
        )}

        <Card className="p-5 sm:p-6 lg:sticky lg:top-6">
          <OrderSummary summary={summary}>
            <p className="text-xs text-muted-foreground">Prices are checked again when you place the order.</p>
          </OrderSummary>
        </Card>
      </div>
    </div>
  );
}
