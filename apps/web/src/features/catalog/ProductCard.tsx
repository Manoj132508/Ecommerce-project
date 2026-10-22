import Link from "next/link";
import { AddToCartControls } from "@/features/cart/AddToCartControls";
import { ProductImage, RatingStars } from "./ProductImage";
import { formatMoney, type Product } from "./product";

/** Grid cell sizes: the image box is at most 180 px wide (see ProductGrid columns). */
const CARD_IMAGE_SIZES = "(min-width: 1280px) 180px, (min-width: 640px) 170px, 140px";

export function ProductCard({ product, preloadImage, returnTo }: { product: Product; preloadImage: boolean; returnTo: string }) {
  const href = `/products/${encodeURIComponent(product.id)}`;
  return (
    <article className="flex min-w-0 flex-col border-b border-r border-[#f0f0f0] px-3 pb-5 pt-6 sm:px-5">
      <Link href={href} className="mx-auto mb-4 block w-[140px] rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#198754] sm:w-[170px] xl:w-[180px]" tabIndex={-1} aria-hidden="true">
        <ProductImage product={product} sizes={CARD_IMAGE_SIZES} preload={preloadImage} />
      </Link>
      <h2 className="mb-2 line-clamp-2 min-h-10 text-base font-normal">
        <Link href={href} className="rounded-sm hover:text-[#198754] focus-visible:outline-2 focus-visible:outline-[#198754]">
          {product.name}
        </Link>
      </h2>
      <div className="mb-2">
        <RatingStars stars={product.rating.stars} count={product.rating.count} />
      </div>
      <p className="mb-3 font-bold">{formatMoney(product.priceCents)}</p>
      <div className="flex-1" />
      <AddToCartControls productId={product.id} productName={product.name} returnTo={returnTo} compact />
    </article>
  );
}

export function ProductGrid({ products, returnTo }: { products: Product[]; returnTo: string }) {
  return (
    <div className="grid grid-cols-1 min-[380px]:grid-cols-2 min-[640px]:grid-cols-3 min-[900px]:grid-cols-4 min-[1150px]:grid-cols-5 min-[1400px]:grid-cols-6">
      {products.map((product, index) => (
        // The first row is above the fold on every layout.
        <ProductCard key={product.id} product={product} preloadImage={index < 4} returnTo={returnTo} />
      ))}
    </div>
  );
}
