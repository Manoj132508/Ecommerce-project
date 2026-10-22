"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { SessionUser } from "@/features/auth/api";
import { useCartQuery, useCheckoutQuery } from "@/features/cart/hooks";
import { ProductImage } from "@/features/catalog/ProductImage";
import { formatMoney } from "@/features/catalog/product";
import { useCreateOrder } from "@/features/orders/hooks";
import type { CustomerDetails } from "@/features/orders/api";
import { ApiError } from "@/lib/api/client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { checkoutStepChanged } from "@/store/uiSlice";

const emptyCustomer = (user: SessionUser): CustomerDetails => ({
  fullName: user.name,
  email: user.email,
  phone: "",
  address: "",
  city: "",
  postalCode: "",
  country: "United Kingdom",
});

const fieldClass = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#198754]";

export function CheckoutPageClient({ user }: { user: SessionUser }) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const step = useAppSelector((state) => state.ui.checkoutStep);
  const cart = useCartQuery();
  const checkout = useCheckoutQuery();
  const create = useCreateOrder();
  const [customer, setCustomer] = useState(() => emptyCustomer(user));
  // One key per reviewed set of details: retries of the same review replay
  // safely, and changed details start a new attempt (the server refuses a key
  // reused with different details). A completed attempt has already cleared
  // the cart, so a new key can never place a second order for it.
  const attempt = useRef<{ key: string; details: string } | null>(null);
  const items = cart.data ?? [];
  const summary = checkout.data?.paymentSummary;
  const invalid = items.some((item) => item.unavailable) || Boolean(summary?.unavailableProductIds.length);

  useEffect(() => () => { dispatch(checkoutStepChanged("details")); }, [dispatch]);

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const name = event.currentTarget.name as keyof CustomerDetails;
    const { value } = event.currentTarget;
    setCustomer((current) => ({ ...current, [name]: value }));
  };

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!summary?.totalItems || invalid) return;
    const details = JSON.stringify(customer);
    if (attempt.current?.details !== details) attempt.current = { key: crypto.randomUUID(), details };
    dispatch(checkoutStepChanged("review"));
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

  if (cart.isPending || checkout.isPending) return <p aria-live="polite">Loading secure checkout…</p>;
  const loadError = cart.error ?? checkout.error;
  if (loadError) return <p role="alert" className="text-red-700">{loadError.message}</p>;
  if (items.length === 0 || !summary?.totalItems) {
    return (
      <section className="rounded-lg border p-8 text-center">
        <h1 className="mb-2 text-2xl font-bold">Your cart is empty</h1>
        {create.isError && (
          // The response to an earlier attempt was lost, but the server may still have placed the order.
          <p role="status" className="mb-3 text-slate-700">
            Your last attempt may have completed. <Link href="/orders" className="font-semibold text-[#08783e] underline">Check your orders</Link> before ordering again.
          </p>
        )}
        <Link href="/products" className="font-semibold text-[#08783e] underline">Continue shopping</Link>
      </section>
    );
  }
  if (invalid) {
    return (
      <section role="alert" className="rounded-lg border border-red-300 bg-red-50 p-6">
        <h1 className="mb-2 text-2xl font-bold text-red-800">Checkout is not available yet</h1>
        <p className="mb-4 text-red-700">Remove unavailable products from your cart before continuing.</p>
        <Link href="/cart" className="font-semibold text-red-800 underline">Return to your cart</Link>
      </section>
    );
  }

  const createMessage = create.error instanceof ApiError
    ? create.error.status === 409
      ? `${create.error.message} Review your cart and try again.`
      : create.error.status === 403
        ? "Your session changed. Refresh the page and try again."
        : create.error.message
    : create.error?.message;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Checkout</h1><p className="text-slate-600">Delivery details and final review</p></div>
        <p className="rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-[#08783e]">Step {step === "details" ? "1 of 2" : "2 of 2"}</p>
      </div>

      {createMessage && <p role="alert" className="mb-5 rounded border border-red-300 bg-red-50 p-3 text-red-700">{createMessage}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        {step === "details" ? (
          <form onSubmit={review} className="rounded-lg border bg-white p-5 shadow-sm sm:p-6">
            <h2 className="mb-5 text-xl font-bold">Customer and delivery details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>Full name<input name="fullName" value={customer.fullName} onChange={change} autoComplete="name" maxLength={100} required className={fieldClass} /></label>
              <label>Email<input type="email" name="email" value={customer.email} onChange={change} autoComplete="email" maxLength={160} required className={fieldClass} /></label>
              <label>Phone<input type="tel" name="phone" value={customer.phone} onChange={change} autoComplete="tel" maxLength={30} required className={fieldClass} /></label>
              <label>Country<input name="country" value={customer.country} onChange={change} autoComplete="country-name" maxLength={80} required className={fieldClass} /></label>
              <label className="sm:col-span-2">Address<input name="address" value={customer.address} onChange={change} autoComplete="street-address" maxLength={200} required className={fieldClass} /></label>
              <label>City<input name="city" value={customer.city} onChange={change} autoComplete="address-level2" maxLength={80} required className={fieldClass} /></label>
              <label>Postal code<input name="postalCode" value={customer.postalCode} onChange={change} autoComplete="postal-code" maxLength={20} required className={fieldClass} /></label>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Link href="/cart" className="rounded border px-5 py-2 text-center font-semibold hover:bg-slate-50">Back to cart</Link>
              <button type="submit" className="rounded bg-[#198754] px-5 py-2 font-semibold text-white hover:bg-[#126c45]">Review order</button>
            </div>
          </form>
        ) : (
          <section className="rounded-lg border bg-white p-5 shadow-sm sm:p-6">
            <h2 className="mb-4 text-xl font-bold">Final review</h2>
            <div className="mb-5 rounded bg-slate-50 p-4">
              <h3 className="font-semibold">Deliver to</h3>
              <address className="mt-1 not-italic text-slate-700">{customer.fullName}<br />{customer.address}<br />{customer.city}, {customer.postalCode}<br />{customer.country}</address>
              <p className="mt-2 text-sm text-slate-600">{customer.email} · {customer.phone}</p>
            </div>
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.productId} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 py-3">
                  {item.product && <ProductImage product={item.product} sizes="64px" />}
                  <div><p className="font-semibold">{item.product?.name}</p><p className="text-sm text-slate-600">Quantity {item.quantity}</p></div>
                  <p className="font-medium">{item.product ? formatMoney(item.product.priceCents * item.quantity) : "—"}</p>
                </li>
              ))}
            </ul>
            <p className="mt-5 rounded bg-amber-50 p-3 text-sm text-amber-900">No payment provider is connected. Placing the order records it; it does not charge a card or claim payment success.</p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => dispatch(checkoutStepChanged("details"))} className="rounded border px-5 py-2 font-semibold hover:bg-slate-50">Edit details</button>
              <button type="button" onClick={placeOrder} disabled={create.isPending} className="rounded bg-[#198754] px-5 py-2 font-semibold text-white hover:bg-[#126c45] disabled:cursor-not-allowed disabled:opacity-60">{create.isPending ? "Placing order…" : "Confirm and place order"}</button>
            </div>
          </section>
        )}

        <aside className="rounded-lg border bg-white p-5 shadow-sm lg:sticky lg:top-4">
          <h2 className="mb-4 text-xl font-bold">Order summary</h2>
          <dl className="space-y-2">
            <div className="flex justify-between"><dt>Items ({summary.totalItems})</dt><dd>{formatMoney(summary.productCostCents)}</dd></div>
            <div className="flex justify-between"><dt>Shipping</dt><dd>{formatMoney(summary.shippingCostCents)}</dd></div>
            <div className="flex justify-between"><dt>Tax</dt><dd>{formatMoney(summary.taxCents)}</dd></div>
            <div className="flex justify-between border-t pt-3 text-lg font-bold text-[#08783e]"><dt>Total</dt><dd>{formatMoney(summary.totalCostCents)}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">Prices are checked again when you place the order.</p>
        </aside>
      </div>
    </div>
  );
}
