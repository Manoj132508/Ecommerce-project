import Link from "next/link";
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

/** Product listing with search (?q=) and category filter (?category=), rendered on the server. */
export function CatalogView({ products, query, category, basePath, heading }: CatalogViewProps) {
  const visible = filterProducts(products, { query, category });
  const categories = categoriesOf(products);
  const returnTo = hrefFor(basePath, query, category);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h1 className="text-2xl font-bold">{heading}</h1>
        <p className="text-sm text-slate-600" role="status">
          {query ? `${visible.length} result${visible.length === 1 ? "" : "s"} for “${query}”` : `${visible.length} product${visible.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {categories.length > 0 && (
        <nav aria-label="Categories" className="flex flex-wrap gap-2 px-1">
          <Link
            href={hrefFor(basePath, query, "")}
            aria-current={category ? undefined : "page"}
            className={`rounded-full border px-3 py-1 text-sm ${category ? "border-slate-300 hover:bg-slate-100" : "border-[#084f2d] bg-[#084f2d] text-white"}`}
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
                className={`rounded-full border px-3 py-1 text-sm ${active ? "border-[#084f2d] bg-[#084f2d] text-white" : "border-slate-300 hover:bg-slate-100"}`}
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
        <p className="p-8 text-center">
          No products match your search.{" "}
          <Link href={basePath} className="font-medium text-[#198754] underline underline-offset-4">Show all products</Link>
        </p>
      )}
    </div>
  );
}
