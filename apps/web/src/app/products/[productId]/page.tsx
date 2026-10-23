import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCartControls } from "@/features/cart/AddToCartControls";
import { ProductImage, RatingStars } from "@/features/catalog/ProductImage";
import { Price } from "@/features/catalog/Price";
import { productImageSource, type Product } from "@/features/catalog/product";
import { getProduct } from "@/lib/server/catalog";

type Params = Promise<{ productId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const product = await getProduct((await params).productId);
  if (!product) return { title: "Product not found", robots: { index: false } };
  const image = productImageSource(product.image);
  return {
    title: product.name,
    description: product.description.slice(0, 160) || undefined,
    alternates: { canonical: `/products/${product.id}` },
    openGraph: { title: product.name, type: "website", ...(image?.local ? { images: [{ url: image.src, width: 720, height: 720, alt: product.name }] } : {}) },
  };
}

/** schema.org Product data for search engines; "<" is escaped so the JSON cannot close the script tag. */
function productJsonLd(product: Product) {
  const image = productImageSource(product.image);
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    category: product.category || undefined,
    image: image?.src,
    aggregateRating: product.rating.count > 0
      ? { "@type": "AggregateRating", ratingValue: product.rating.stars, reviewCount: product.rating.count }
      : undefined,
    offers: { "@type": "Offer", priceCurrency: "USD", price: (product.priceCents / 100).toFixed(2) },
  }).replace(/</g, "\\u003c");
}

// No loading.tsx may wrap this page (or the account area): a Suspense boundary
// would start streaming a 200 before notFound()/redirect() run, and missing
// products must answer 404. The listing skeletons live in route groups instead.
export default async function ProductPage({ params }: { params: Params }) {
  const product = await getProduct((await params).productId);
  if (!product) notFound();

  const sections: [string, string][] = [
    ["About this product", product.description],
    ["How it works", product.howItWorks],
    ["Care and guidance", product.careInstructions],
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: productJsonLd(product) }} />
      <Link href="/products" className="focus-ring mb-5 inline-block rounded-sm font-semibold text-primary hover:underline hover:underline-offset-4">
        &larr; Back to products
      </Link>

      <article className="grid gap-8 rounded-lg border border-border bg-card p-5 shadow-xs md:grid-cols-2 md:p-8 xl:gap-12 xl:p-10">
        <div className="flex items-center justify-center rounded-md bg-surface p-5">
          <ProductImage product={product} sizes="(min-width: 768px) 500px, 90vw" preload className="w-full max-w-[500px]" />
        </div>

        <div className="flex flex-col justify-center">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-primary">{product.category || "Product"}</p>
          <h1 className="mb-4 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl xl:text-4xl">{product.name}</h1>
          <div className="mb-5">
            <RatingStars stars={product.rating.stars} count={product.rating.count} label=" ratings" />
          </div>
          <Price cents={product.priceCents} size="lg" className="mb-5" />
          <AddToCartControls productId={product.id} productName={product.name} returnTo={`/products/${product.id}`} />
        </div>

        <section className="border-t border-border pt-8 md:col-span-2" aria-label="Product information">
          <div className="grid gap-8 lg:grid-cols-2">
            {sections.filter(([, text]) => text).map(([title, text]) => (
              <div key={title}>
                <h2 className="mb-3 text-xl font-semibold">{title}</h2>
                <p className="leading-7 text-muted-foreground">{text}</p>
              </div>
            ))}
            {product.highlights.length > 0 && (
              <div>
                <h2 className="mb-3 text-xl font-semibold">Product highlights</h2>
                <ul className="grid gap-2 text-muted-foreground sm:grid-cols-2">
                  {product.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                      {highlight}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </article>
    </div>
  );
}
