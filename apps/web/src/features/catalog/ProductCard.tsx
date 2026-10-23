import Link from "next/link";
import { AddToCartControls } from "@/features/cart/AddToCartControls";
import { Price } from "./Price";
import { ProductImage, RatingStars } from "./ProductImage";
import type { Product } from "./product";

/**
 * Image widths for the optimiser: a card is at most ~230 px wide inside the
 * 1280 px container (5 columns), ~45 % of a phone screen with 2 columns.
 */
const CARD_IMAGE_SIZES = "(min-width: 1024px) 220px, (min-width: 640px) 30vw, 45vw";

interface ProductCardProps {
  product: Product;
  preloadImage: boolean;
  returnTo: string;
  /** h2 on a listing page; h3 inside a titled section (home, related products). */
  headingLevel?: 2 | 3;
}

export function ProductCard({ product, preloadImage, returnTo, headingLevel = 2 }: ProductCardProps) {
  const href = `/products/${encodeURIComponent(product.id)}`;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <article className="group flex min-w-0 flex-col rounded-md border border-border bg-card p-3 shadow-xs transition-shadow hover:shadow-md sm:p-4">
      {/* The image repeats the name link, so it is skipped by keyboard and screen readers. */}
      <Link href={href} className="mb-3 block overflow-hidden rounded-sm bg-surface p-3" tabIndex={-1} aria-hidden="true">
        <ProductImage
          product={product}
          sizes={CARD_IMAGE_SIZES}
          preload={preloadImage}
          className="mx-auto w-full max-w-[200px] transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </Link>
      {product.category && <p className="mb-1 truncate text-xs font-medium text-muted-foreground">{product.category}</p>}
      <Heading className="line-clamp-2 min-h-10 text-sm font-medium leading-5 sm:min-h-12 sm:text-base sm:leading-6">
        <Link href={href} className="focus-ring rounded-sm hover:text-primary hover:underline hover:underline-offset-4">
          {product.name}
        </Link>
      </Heading>
      <div className="mt-2">
        <RatingStars stars={product.rating.stars} count={product.rating.count} />
      </div>
      <Price cents={product.priceCents} className="mt-2" />
      <div className="flex-1" />
      <div className="mt-3">
        <AddToCartControls productId={product.id} productName={product.name} returnTo={returnTo} compact />
      </div>
    </article>
  );
}

/** 1 column on the narrowest phones, then 2/3/4/5 (the 1280 px container fits five). */
export const PRODUCT_GRID_CLASS = "grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5";

/** Four across from lg: a single row of picks (home, related products). */
export const PRODUCT_ROW_CLASS = "grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 sm:gap-4 lg:grid-cols-4";

export function ProductGrid({ products, returnTo, headingLevel = 2, preloadCount = 4, className = PRODUCT_GRID_CLASS }: {
  products: Product[];
  returnTo: string;
  headingLevel?: 2 | 3;
  /** Images fetched early: the first row, when the grid is above the fold. */
  preloadCount?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {products.map((product, index) => (
        <ProductCard key={product.id} product={product} preloadImage={index < preloadCount} returnTo={returnTo} headingLevel={headingLevel} />
      ))}
    </div>
  );
}
