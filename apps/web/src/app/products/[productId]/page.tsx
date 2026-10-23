import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckIcon } from "@/components/ui/icons";
import { AddToCartControls } from "@/features/cart/AddToCartControls";
import { PRODUCT_ROW_CLASS, ProductGrid } from "@/features/catalog/ProductCard";
import { ProductImage, RatingStars } from "@/features/catalog/ProductImage";
import { Price } from "@/features/catalog/Price";
import { catalogHref, productImageSource, topRated, type Product } from "@/features/catalog/product";
import { getCatalog, getProduct } from "@/lib/server/catalog";

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

/** Up to four other products from the same category, top rated first. */
function relatedProducts(catalog: Product[], product: Product): Product[] {
  const category = product.category.trim().toLowerCase();
  if (!category) return [];
  const others = catalog.filter((other) => other.id !== product.id && other.category.trim().toLowerCase() === category);
  const rated = topRated(others, RELATED);
  return [...rated, ...others.filter((other) => !rated.includes(other))].slice(0, RELATED);
}

const RELATED = 4;
const crumbLink = "focus-ring rounded-sm hover:text-foreground hover:underline hover:underline-offset-4";

// No loading.tsx may wrap this page (or the account area): a Suspense boundary
// would start streaming a 200 before notFound()/redirect() run, and missing
// products must answer 404. The listing skeletons live in route groups instead.
export default async function ProductPage({ params }: { params: Params }) {
  const product = await getProduct((await params).productId);
  if (!product) notFound();
  const related = relatedProducts(await getCatalog(), product);
  const categoryHref = catalogHref("/products", { category: product.category });

  const sections: [string, string][] = [
    ["About this product", product.description],
    ["How it works", product.howItWorks],
    ["Care and guidance", product.careInstructions],
  ];
  const details = sections.filter(([, text]) => text);

  return (
    <div className="flex flex-col gap-10 sm:gap-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: productJsonLd(product) }} />

      <div className="flex flex-col gap-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <li><Link href="/" className={crumbLink}>Home</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href="/products" className={crumbLink}>Products</Link></li>
            {product.category && (
              <>
                <li aria-hidden="true">/</li>
                <li><Link href={categoryHref} className={crumbLink}>{product.category}</Link></li>
              </>
            )}
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="max-w-full truncate font-medium text-foreground">{product.name}</li>
          </ol>
        </nav>

        <article className="grid gap-8 md:grid-cols-2 lg:gap-12">
          {/* Fixed square box: no layout shift; stays in view while the details scroll on wide screens. */}
          <div className="self-start rounded-lg border border-border bg-surface p-6 sm:p-10 md:sticky md:top-6">
            <ProductImage product={product} sizes="(min-width: 1280px) 520px, (min-width: 768px) 42vw, 85vw" preload className="mx-auto w-full max-w-[520px]" />
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-3">
              {product.category && (
                <Link href={categoryHref} className="focus-ring w-fit rounded-sm text-sm font-semibold uppercase tracking-wide text-primary hover:underline hover:underline-offset-4">
                  {product.category}
                </Link>
              )}
              <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl xl:text-4xl">{product.name}</h1>
              <RatingStars stars={product.rating.stars} count={product.rating.count} label=" ratings" />
            </div>

            <Card className="flex flex-col gap-5 p-5 sm:p-6">
              <Price cents={product.priceCents} size="lg" />
              <AddToCartControls productId={product.id} productName={product.name} returnTo={`/products/${product.id}`} />
            </Card>

            {product.highlights.length > 0 && (
              <section aria-labelledby="highlights">
                <h2 id="highlights" className="mb-3 text-lg font-semibold">Product highlights</h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {product.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2 text-muted-foreground">
                      <CheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
                      {highlight}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </article>
      </div>

      {details.length > 0 && (
        <section aria-label="Product information" className="grid gap-4 lg:grid-cols-3">
          {details.map(([title, text]) => (
            <Card key={title} className="p-5 sm:p-6">
              <h2 className="mb-3 text-lg font-semibold">{title}</h2>
              <p className="leading-7 text-muted-foreground">{text}</p>
            </Card>
          ))}
        </section>
      )}

      {related.length > 0 && (
        <section aria-labelledby="related">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <h2 id="related" className="text-xl font-semibold tracking-tight sm:text-2xl">More in {product.category}</h2>
            <Link href={categoryHref} className={buttonVariants({ variant: "link" })}>View all {product.category}</Link>
          </div>
          <ProductGrid products={related} returnTo={`/products/${product.id}`} headingLevel={3} preloadCount={0} className={PRODUCT_ROW_CLASS} />
        </section>
      )}
    </div>
  );
}
