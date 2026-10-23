import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { buttonVariants } from "@/components/ui/button";
import { CategoryGrid, describeCategories, HomeHero, SectionHeader } from "@/features/catalog/HomeSections";
import { PRODUCT_ROW_CLASS, ProductGrid } from "@/features/catalog/ProductCard";
import { catalogHref, categoriesOf, categorySummaries, topRated } from "@/features/catalog/product";
import { getCatalog } from "@/lib/server/catalog";
import { publicEnv } from "@/lib/env/public";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  // Reading the request first keeps the page dynamic: the catalogue is fetched per request, never at build time.
  await searchParams;
  const categories = categoriesOf(await getCatalog());
  return {
    alternates: { canonical: "/" },
    description: categories.length > 0 ? `Shop ${describeCategories(categories)} at ${publicEnv.appName}.` : undefined,
  };
}

const TOP_RATED = 4;

// The storefront home, server-rendered from the catalogue: a hero with the
// highest-rated product, category entry points and the top-rated row. The
// full listing with search, filters and sorting is /products.
// Old listing links (/?q=, ?category=, ?sort=) are redirected to /products in next.config.ts.
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  // Reading the request keeps the page dynamic (the catalogue is cached for 60 s, never baked in at build time).
  await searchParams;
  const products = await getCatalog();
  const categories = categorySummaries(products);
  const picks = topRated(products, TOP_RATED);

  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      <HomeHero productCount={products.length} categories={categories.map(({ name }) => name)} spotlight={picks[0]} />

      {products.length === 0 && (
        <EmptyState title="No products yet">
          <p>The catalogue is empty. Please check back later.</p>
        </EmptyState>
      )}

      {categories.length > 0 && (
        // scroll-mt keeps the heading clear of the top edge when "Browse categories" jumps here.
        <section aria-labelledby="categories" className="scroll-mt-6">
          <SectionHeader id="categories" title="Shop by category" />
          <CategoryGrid categories={categories} />
        </section>
      )}

      {picks.length > 0 && (
        <section aria-labelledby="top-rated">
          <SectionHeader
            id="top-rated"
            title="Top rated"
            description="The highest average customer ratings in the catalogue."
            action={<Link href={catalogHref("/products", {})} className={buttonVariants({ variant: "link" })}>View all products</Link>}
          />
          <ProductGrid products={picks} returnTo="/" headingLevel={3} preloadCount={0} className={PRODUCT_ROW_CLASS} />
        </section>
      )}

      {products.length > 0 && (
        <section aria-labelledby="browse-all" className="rounded-lg border border-border bg-surface p-6 text-center sm:p-10">
          <h2 id="browse-all" className="text-xl font-semibold tracking-tight sm:text-2xl">Browse the full catalogue</h2>
          <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
            All {products.length} products, with search, category filters and sorting by name or price.
          </p>
          <Link href="/products" className={buttonVariants({ size: "lg", className: "mt-6" })}>
            See all {products.length} products
          </Link>
        </section>
      )}
    </div>
  );
}
