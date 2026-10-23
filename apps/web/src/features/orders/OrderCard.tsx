import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ProductImage } from "@/features/catalog/ProductImage";
import { formatMoney, type Product } from "@/features/catalog/product";
import { formatDeliveryDate, formatOrderTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, OrderLine, ProductSnapshot } from "./api";
import { BuyAgainButton } from "./BuyAgainButton";
import { OrderStatusBadge } from "./OrderStatus";

/**
 * PostgreSQL orders store a snapshot of each product (name, image and the
 * price paid) that never changes. Older MongoDB orders only reference the
 * product, so the API returns today's catalogue entry: its price is the
 * current price, not the price paid.
 */
const isCurrentProduct = (product: Product | ProductSnapshot): product is Product => "rating" in product;

export const trackingHref = (orderId: string, productId: string) => (
  `/tracking?${new URLSearchParams({ orderId, productId }).toString()}`
);

const itemCount = (order: Order) => order.products.reduce((total, line) => total + line.quantity, 0);

/** What is known about the price of a line, worded so a current price is never mistaken for the price paid. */
function LinePrice({ line }: { line: OrderLine }) {
  if (line.product && !isCurrentProduct(line.product)) {
    return <p className="text-sm font-medium tabular-nums">Price paid: {formatMoney(line.product.priceCents)} each</p>;
  }
  return (
    <div className="text-sm text-muted-foreground">
      <p>Price paid not recorded</p>
      {line.product && <p className="tabular-nums">Current price {formatMoney(line.product.priceCents)} (not the price paid)</p>}
    </div>
  );
}

/** One product of an order: photo, name, quantity, delivery date, price paid, Buy again and Track package. */
export function OrderLineItem({ order, line }: { order: Order; line: OrderLine }) {
  return (
    <li className="grid gap-4 py-5 sm:grid-cols-[96px_1fr_auto] sm:items-start">
      {line.product ? (
        <div className="w-24 rounded-sm bg-surface p-1.5"><ProductImage product={line.product} decorative sizes="96px" /></div>
      ) : (
        <div className="flex aspect-square w-24 items-center justify-center rounded-sm bg-secondary p-2 text-center text-xs text-muted-foreground">Image not available</div>
      )}
      <div className="grid min-w-0 gap-1">
        <h3 className="font-semibold leading-snug">{line.product?.name ?? "Product details not recorded"}</h3>
        <p className="text-sm text-muted-foreground">Quantity: {line.quantity}</p>
        <p className="text-sm text-muted-foreground">
          {order.status === "cancelled" ? "Was expected" : "Expected"}: {formatDeliveryDate(line.estimatedDeliveryTimeMs)}
        </p>
        <LinePrice line={line} />
      </div>
      <div className="grid gap-2 sm:w-44">
        <BuyAgainButton productId={line.productId} productName={line.product?.name} />
        <Link
          href={trackingHref(order.id, line.productId)}
          aria-label={line.product ? `Track package for ${line.product.name}` : undefined}
          className={buttonVariants({ variant: "outline" })}
        >
          Track package
        </Link>
      </div>
    </li>
  );
}

/** An order: header (date, total, status, number) and its lines; the details page adds the delivery address. */
export function OrderCard({ order, detailed = false }: { order: Order; detailed?: boolean }) {
  const placed = formatOrderTime(order.orderTimeMs);
  const count = itemCount(order);
  return (
    <article aria-label={`Order placed ${placed}`} className="overflow-hidden rounded-md border border-border bg-card shadow-xs">
      <header className="grid gap-4 border-b border-border bg-surface px-4 py-4 text-sm sm:grid-cols-[repeat(3,auto)_1fr] sm:items-start sm:gap-8 sm:px-6">
        <div>
          <p className="font-medium text-muted-foreground">Order placed</p>
          <p className="font-semibold">{placed}</p>
        </div>
        <div>
          <p className="font-medium text-muted-foreground">Order total</p>
          <p className="font-semibold tabular-nums">{formatMoney(order.totalCostCents)}</p>
        </div>
        <div className="grid gap-1">
          <p className="font-medium text-muted-foreground">{count} item{count === 1 ? "" : "s"}</p>
          {/* The details page shows the status once, under its heading. */}
          {!detailed && <OrderStatusBadge status={order.status} />}
        </div>
        <div className="min-w-0 sm:text-right">
          <p className="font-medium text-muted-foreground">Order number</p>
          <p className="break-all font-mono text-xs leading-5">{order.id}</p>
          {!detailed && (
            <Link href={`/orders/${order.id}`} aria-label={`View order placed ${placed}`} className={cn(buttonVariants({ variant: "link", size: "sm" }), "mt-1 h-auto min-h-0 p-0")}>
              View order
            </Link>
          )}
        </div>
      </header>
      <ul aria-label="Products in this order" className="divide-y divide-border px-4 sm:px-6">
        {order.products.map((line, index) => <OrderLineItem key={`${line.productId}-${index}`} order={order} line={line} />)}
      </ul>
    </article>
  );
}
