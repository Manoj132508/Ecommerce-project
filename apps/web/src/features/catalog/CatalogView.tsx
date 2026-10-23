import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProductGrid } from "./ProductCard";
import { SortControl } from "./SortControl";
import { catalogHref, categoriesOf, filterProducts, sortLabel, sortProducts, type Product, type SortOrder } from "./product";

interface CatalogViewProps {
  products: Product[];
  query: string;
  category: string;
  sort: SortOrder;
  /** The page's own path, for the category links, the sort form and the return path after sign-in. */
  basePath: string;
  heading: string;
}

/** Category chip; the current one is filled and marked aria-current (not colour alone: also bold). */
function chipClass(current: boolean) {
  return cn(
    "focus-ring inline-flex min-h-11 items-center rounded-full border px-4 text-sm lg:min-h-9",
    current ? "border-brand bg-brand font-semibold text-brand-foreground" : "border-border bg-background hover:border-primary hover:bg-accent",
  );
}

function countText(count: number, query: string) {
  return query ? `${count} result${count === 1 ? "" : "s"} for “${query}”` : `${count} product${count === 1 ? "" : "s"}`;
}

/**
 * Product listing with search (?q=), category (?category=) and sort order
 * (?sort=), rendered on the server: the URL is the only state, so links can be
 * shared and Back restores every setting.
 */
export function CatalogView({ products, query, category, sort, basePath, heading }: CatalogViewProps) {
  const visible = sortProducts(filterProducts(products, { query, category }), sort);
  const categories = categoriesOf(products);
  const returnTo = catalogHref(basePath, { query, category, sort });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h1>
        <p className="text-sm text-muted-foreground" role="status">
          {countText(visible.length, query)}
          {sort && <span className="sr-only">, sorted by {sortLabel(sort).toLowerCase()}</span>}
        </p>
      </div>

      <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
        {categories.length > 0 && (
          <nav aria-label="Categories" className="flex flex-wrap gap-2">
            <Link href={catalogHref(basePath, { query, sort })} aria-current={category ? undefined : "page"} className={chipClass(!category)}>
              All
            </Link>
            {categories.map((name) => {
              const active = name.toLowerCase() === category.toLowerCase();
              return (
                <Link
                  key={name}
                  href={catalogHref(basePath, { query, category: name, sort })}
                  aria-current={active ? "page" : undefined}
                  className={chipClass(active)}
                >
                  {name}
                </Link>
              );
            })}
          </nav>
        )}
        {products.length > 0 && <SortControl basePath={basePath} query={query} category={category} sort={sort} />}
      </div>

      {visible.length > 0 ? (
        <ProductGrid products={visible} returnTo={returnTo} />
      ) : products.length === 0 ? (
        <EmptyState title="No products yet">
          <p>The catalogue is empty. Please check back later.</p>
        </EmptyState>
      ) : (
        <EmptyState
          title="No products found"
          action={(
            <div className="flex flex-wrap justify-center gap-3">
              <Link href={basePath} className={buttonVariants({ variant: "outline" })}>Show all products</Link>
              {query && category && (
                <Link href={catalogHref(basePath, { query, sort })} className={buttonVariants({ variant: "ghost" })}>Search all categories</Link>
              )}
            </div>
          )}
        >
          <p>
            {query
              ? `No products match “${query}”${category ? ` in ${category}` : ""}. Check the spelling or try a more general word.`
              : `There are no products in ${category || "this category"}.`}
          </p>
        </EmptyState>
      )}
    </div>
  );
}
