import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env/public";
import { CatalogUnavailableError, getCatalog } from "@/lib/server/catalog";

// Rendered per request (from the 60 s catalogue cache), never at build time,
// when the API may not be reachable.
export const dynamic = "force-dynamic";

/** Public catalogue pages. Sitemap URLs must be absolute: empty until NEXT_PUBLIC_SITE_URL is set. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = publicEnv.siteUrl;
  if (!site) return [];
  const url = (path: string) => new URL(path, site).href;
  let products: Awaited<ReturnType<typeof getCatalog>> = [];
  try {
    products = await getCatalog();
  } catch (error) {
    if (!(error instanceof CatalogUnavailableError)) throw error;
  }
  return [
    { url: url("/"), changeFrequency: "daily", priority: 1 },
    { url: url("/products"), changeFrequency: "daily", priority: 0.9 },
    ...products.map((product) => ({ url: url(`/products/${product.id}`), changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
