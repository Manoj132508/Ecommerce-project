import Image from "next/image";
import { productImageSource, ratingImageSource, type Product } from "./product";

interface ProductImageProps {
  product: Pick<Product, "image" | "name">;
  /** Responsive width hints for the optimiser (CSS media conditions). */
  sizes: string;
  /** Above the fold (first row, product page): fetched early instead of lazily. */
  preload?: boolean;
  className?: string;
}

/**
 * Product photo in a square box. Catalogue images are 720×720 JPEGs in
 * public/images/products, served through the Next.js optimiser (resized,
 * WebP); off-site https images are shown as they are.
 */
export function ProductImage({ product, sizes, preload = false, className = "" }: ProductImageProps) {
  const source = productImageSource(product.image);
  if (!source) {
    return (
      <div className={`flex aspect-square items-center justify-center rounded bg-slate-100 text-sm text-slate-500 ${className}`}>
        Image unavailable
      </div>
    );
  }
  return (
    <div className={`relative aspect-square ${className}`}>
      <Image
        src={source.src}
        alt={product.name}
        fill
        sizes={sizes}
        preload={preload}
        unoptimized={!source.local}
        className="rounded object-contain"
      />
    </div>
  );
}

/** Star rating image (192×38 PNG) with the rating as text for screen readers. */
export function RatingStars({ stars, count, label = "" }: { stars: number; count: number; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Image src={ratingImageSource(stars)} alt={`${stars} out of 5 stars`} width={100} height={20} />
      <span className="text-sm text-[#198754]">{count}{label}</span>
    </div>
  );
}
