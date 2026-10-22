import Link from "next/link";
import { ProductImage } from "@/features/catalog/ProductImage";
import { formatMoney, type Product } from "@/features/catalog/product";
import type { Order, ProductSnapshot } from "./api";

const fullDate = (milliseconds: number) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(milliseconds);
const deliveryDate = (milliseconds: number) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(milliseconds);
const isCurrentProduct = (product: Product | ProductSnapshot): product is Product => "rating" in product;

export function OrderCard({ order, detailed = false }: { order: Order; detailed?: boolean }) {
  return (
    <article className="overflow-hidden rounded-lg border bg-white shadow-sm">
      <header className="grid gap-3 bg-slate-50 px-4 py-4 text-sm sm:grid-cols-[1fr_auto_auto] sm:px-5">
        <div><span className="block font-semibold">Order placed</span>{fullDate(order.orderTimeMs)}</div>
        <div><span className="block font-semibold">Stored total</span>{formatMoney(order.totalCostCents)}</div>
        <div className="min-w-0 sm:text-right"><span className="block font-semibold">Order ID</span><span className="break-all">{order.id}</span></div>
      </header>
      <div className="divide-y px-4 sm:px-5">
        {order.products.map((line, index) => (
          <div key={`${line.productId}-${index}`} className="grid gap-4 py-5 sm:grid-cols-[96px_1fr_auto] sm:items-center">
            {line.product ? <ProductImage product={line.product} sizes="96px" /> : <div className="flex aspect-square items-center justify-center rounded bg-slate-100 p-2 text-center text-xs text-slate-500">Historical product unavailable</div>}
            <div>
              <h2 className="font-bold">{line.product?.name ?? "Product information unavailable"}</h2>
              <p className="text-sm text-slate-600">Quantity: {line.quantity}</p>
              <p className="text-sm text-slate-600">Expected: {deliveryDate(line.estimatedDeliveryTimeMs)}</p>
              {line.product && !isCurrentProduct(line.product) ? (
                <p className="text-sm font-medium">Saved unit price: {formatMoney(line.product.priceCents)}</p>
              ) : (
                <p className="text-sm text-slate-500">Historical unit price unavailable</p>
              )}
            </div>
            {!detailed && <Link href={`/orders/${order.id}`} className="rounded border border-[#198754] px-4 py-2 text-center font-semibold text-[#08783e] hover:bg-green-50">View order</Link>}
          </div>
        ))}
      </div>
      {detailed && order.customer && (
        <footer className="border-t bg-slate-50 p-5">
          <h2 className="mb-2 font-bold">Delivery details</h2>
          <address className="not-italic text-slate-700">{order.customer.fullName}<br />{order.customer.address}<br />{order.customer.city}, {order.customer.postalCode}<br />{order.customer.country}</address>
          <p className="mt-2 text-sm text-slate-600">{order.customer.email} · {order.customer.phone}</p>
        </footer>
      )}
    </article>
  );
}
