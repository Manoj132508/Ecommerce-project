// Catalogue reads for Server Components: public data, fetched from Express
// directly (server to server, no cookies), cached for 60 s, and deduplicated
// within one request (page + generateMetadata).
import "server-only";
import { cache } from "react";
import { parseProducts, PRODUCT_ID, type Product } from "@/features/catalog/product";
import { serverEnv } from "@/lib/env/server";

/** Thrown when the API cannot be reached or answers with an error: the segment's error.tsx shows. */
export class CatalogUnavailableError extends Error {
  override name = "CatalogUnavailableError";
  constructor() {
    super("The product catalogue is unavailable right now.");
  }
}

export const getCatalog = cache(async (): Promise<Product[]> => {
  let response: Response;
  try {
    response = await fetch(new URL("/api/products", serverEnv().backendOrigin), {
      headers: { Accept: "application/json" },
      next: { revalidate: 60, tags: ["catalog"] },
    });
  } catch {
    throw new CatalogUnavailableError();
  }
  if (!response.ok) throw new CatalogUnavailableError();
  return parseProducts(await response.json());
});

/** Null for an id that cannot exist or a product that does not (both become a 404). */
export async function getProduct(id: string): Promise<Product | null> {
  if (!PRODUCT_ID.test(id)) return null;
  return (await getCatalog()).find((product) => product.id === id) ?? null;
}
