import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { CheckIcon } from "@/components/ui/icons";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProductImage } from "@/features/catalog/ProductImage";
import { PRODUCT_ID, searchParam } from "@/features/catalog/product";
import { OrderStatusBadge } from "@/features/orders/OrderStatus";
import { trackPackage, TRACKING_STAGES } from "@/features/orders/tracking";
import { formatDeliveryDate } from "@/lib/format";
import { getServerOrder } from "@/lib/server/orders";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Track package", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The Vite /tracking?orderId=&productId= page. Ownership is checked by
// Express for every request; an unknown, malformed or another user's order,
// or a product that is not in it, is a real 404. No loading.tsx may wrap
// this page (see products/[productId]/page.tsx).
export default async function TrackingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const orderId = searchParam(params.orderId, 36);
  const productId = searchParam(params.productId, 36);
  if (!PRODUCT_ID.test(orderId) || !PRODUCT_ID.test(productId)) notFound();

  const result = await getServerOrder(orderId);
  if (result.kind === "signed-out") {
    redirect(`/login?from=${encodeURIComponent(`/tracking?${new URLSearchParams({ orderId, productId }).toString()}`)}`);
  }
  if (result.kind === "not-found") notFound();
  const { order } = result;
  const line = order.products.find((item) => item.productId === productId);
  if (!line) notFound();

  const tracking = trackPackage(order, line.estimatedDeliveryTimeMs);
  const current = tracking.cancelled ? -1 : TRACKING_STAGES.indexOf(tracking.stage);

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <nav aria-label="Order links" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/orders" className="focus-ring rounded-sm font-semibold text-primary underline-offset-4 hover:underline">View all orders</Link>
        <Link href={`/orders/${order.id}`} className="focus-ring rounded-sm font-semibold text-primary underline-offset-4 hover:underline">View this order</Link>
      </nav>

      <Card className="grid gap-6 p-5 sm:p-8">
        <div className="grid gap-2">
          <OrderStatusBadge status={order.status} />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {tracking.cancelled ? "This order was cancelled" : `Arriving on ${formatDeliveryDate(line.estimatedDeliveryTimeMs)}`}
          </h1>
        </div>

        <div className="flex items-center gap-4">
          {line.product ? (
            <div className="w-20 shrink-0 rounded-sm bg-surface p-1.5 sm:w-24"><ProductImage product={line.product} decorative sizes="96px" /></div>
          ) : (
            <div className="flex aspect-square w-20 shrink-0 items-center justify-center rounded-sm bg-secondary p-2 text-center text-xs text-muted-foreground sm:w-24">Image not available</div>
          )}
          <div className="min-w-0">
            <p className="font-semibold">{line.product?.name ?? "Product no longer available"}</p>
            <p className="text-sm text-muted-foreground">Quantity: {line.quantity}</p>
          </div>
        </div>

        {tracking.cancelled ? (
          <Alert variant="warning">This package will not be delivered.</Alert>
        ) : (
          <div className="grid gap-4">
            <ol aria-label="Delivery stages" className="grid grid-cols-3 gap-2">
              {TRACKING_STAGES.map((stage, index) => (
                <li key={stage} aria-current={index === current ? "step" : undefined} className="flex flex-col items-center gap-2 text-center">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full border-2 text-sm font-semibold",
                      index < current && "border-primary bg-primary text-primary-foreground",
                      index === current && "border-primary bg-accent text-accent-foreground",
                      index > current && "border-input text-muted-foreground",
                    )}
                  >
                    {index < current ? <CheckIcon className="size-5" /> : index + 1}
                  </span>
                  <span className={cn("text-sm sm:text-base", index === current ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {stage}{index < current && <>{" "}<span className="sr-only">(done)</span></>}
                  </span>
                </li>
              ))}
            </ol>
            <div role="progressbar" aria-label="Delivery progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tracking.percent} aria-valuetext={tracking.stage} className="h-3 w-full overflow-hidden rounded-full border border-input bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${tracking.percent}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">Progress is estimated from the order and delivery dates, or from the status recorded by the store. No courier tracking is connected.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
