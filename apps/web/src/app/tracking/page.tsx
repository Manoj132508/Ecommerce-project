import type { Metadata } from "next";
import { NarrowContent } from "@/components/layout/Container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProductImage } from "@/features/catalog/ProductImage";
import { PRODUCT_ID, searchParam } from "@/features/catalog/product";
import { trackPackage, TRACKING_STAGES } from "@/features/orders/tracking";
import { formatDeliveryDate } from "@/lib/format";
import { getServerOrder } from "@/lib/server/orders";

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

  return (
    <NarrowContent>
      <div className="max-w-xl">
        <Link href="/orders" className="mb-6 inline-block font-semibold text-[#08783e] underline">View all orders</Link>
        <h1 className="mb-2 text-2xl font-bold sm:text-3xl">
          {tracking.cancelled ? "This order was cancelled" : `Arriving on ${formatDeliveryDate(line.estimatedDeliveryTimeMs)}`}
        </h1>
        <p>{line.product?.name ?? "Product no longer available"}</p>
        <p className="mb-6 text-slate-600">Quantity: {line.quantity}</p>
        {line.product && <ProductImage product={line.product} sizes="150px" className="mb-8 w-[150px]" />}

        {tracking.cancelled ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">This package will not be delivered.</p>
        ) : (
          <>
            <ol className="mb-3 flex justify-between text-base font-medium sm:text-xl" aria-label="Delivery progress">
              {TRACKING_STAGES.map((stage) => (
                <li key={stage} aria-current={tracking.stage === stage ? "step" : undefined} className={tracking.stage === stage ? "text-[#198754]" : "text-slate-500"}>
                  {stage}
                </li>
              ))}
            </ol>
            <div role="progressbar" aria-label="Delivery progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tracking.percent} aria-valuetext={tracking.stage} className="h-6 w-full overflow-hidden rounded-full border border-slate-300">
              <div className="h-full rounded-full bg-[#198754]" style={{ width: `${tracking.percent}%` }} />
            </div>
            <p className="mt-3 text-sm text-slate-600">Progress is estimated from the order and delivery dates.</p>
          </>
        )}
      </div>
    </NarrowContent>
  );
}
