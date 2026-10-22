import type { Metadata } from "next";
import { CatalogView } from "@/features/catalog/CatalogView";
import { searchParam } from "@/features/catalog/product";
import { getCatalog } from "@/lib/server/catalog";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The storefront home: every product, server-rendered (search and category
// filters come from the URL, as on /products).
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = searchParam(params.q);
  return (
    <CatalogView
      products={await getCatalog()}
      query={query}
      category={searchParam(params.category)}
      basePath="/"
      heading={query ? "Search results" : "Products"}
    />
  );
}
