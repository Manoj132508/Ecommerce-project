import type { Metadata } from "next";
import { CatalogView } from "@/features/catalog/CatalogView";
import { searchParam } from "@/features/catalog/product";
import { getCatalog } from "@/lib/server/catalog";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams;
  const query = searchParam(params.q);
  const category = searchParam(params.category);
  return {
    title: query ? `Search: ${query}` : category || "All products",
    alternates: { canonical: "/products" },
    // Search result pages are not worth indexing; the plain listing is.
    ...(query ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = searchParam(params.q);
  const category = searchParam(params.category);
  return (
    <CatalogView
      products={await getCatalog()}
      query={query}
      category={category}
      basePath="/products"
      heading={query ? "Search results" : category || "All products"}
    />
  );
}
