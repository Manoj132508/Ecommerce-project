import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProductGrid } from "./ProductCard";
import { categoriesOf, filterProducts, type Product } from "./product";

interface CatalogViewProps {
  products: Product[];
  query: string;
  category: string;
  /** The page's own path, for the category links and the return path after sign-in. */
  basePath: "/" | "/products";
  heading: string;
}

function hrefFor(basePath: string, query: string, category: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category) params.set("category", category);
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}

/** Category chip; the current one is filled and marked aria-current (not colour alone: also bold). */
function chipClass(current: boolean) {
  return cn(
    "focus-ring inline-flex min-h-11 items-center rounded-full border px-4 text-sm lg:min-h-9",
    current ? "border-brand bg-brand font-semibold text-brand-foreground" : "border-border bg-background hover:border-primary hover:bg-accent",
  );
}

/** Product listing with search (?q=) and category filter (?category=), rendered on the server. */
export function CatalogView({ products, query, category, basePath, heading }: CatalogViewProps) {
  const visible = filterProducts(products, { query, category });
  const categories = categoriesOf(products);
  const returnTo = hrefFor(basePath, query, category);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h1>
        <p className="text-sm text-muted-foreground" role="status">
          {query ? `${visible.length} result${visible.length === 1 ? "" : "s"} for “${query}”` : `${visible.length} product${visible.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {categories.length > 0 && (
        <nav aria-label="Categories" className="flex flex-wrap gap-2">
          <Link
            href={hrefFor(basePath, query, "")}
            aria-current={category ? undefined : "page"}
            className={chipClass(!category)}
          >
            All
          </Link>
          {categories.map((name) => {
            const active = name.toLowerCase() === category.toLowerCase();
            return (
              <Link
                key={name}
                href={hrefFor(basePath, query, name)}
                aria-current={active ? "page" : undefined}
                className={chipClass(active)}
              >
                {name}
              </Link>
            );
          })}
        </nav>
      )}

      {visible.length > 0 ? (
        <ProductGrid products={visible} returnTo={returnTo} />
      ) : (
        <EmptyState title="No products found" action={<Link href={basePath} className={buttonVariants({ variant: "outline" })}>Show all products</Link>}>
          <p>No products match your search.</p>
        </EmptyState>
      )}
    </div>
  );
}
