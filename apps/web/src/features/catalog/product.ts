// Product data as the Express API returns it (GET /api/products), validated,
// plus the catalogue rules shared by server and client code.

export interface ProductRating {
  stars: number;
  count: number;
}

export interface Product {
  id: string;
  image: string;
  name: string;
  description: string;
  howItWorks: string;
  highlights: string[];
  careInstructions: string;
  category: string;
  stock: number;
  rating: ProductRating;
  priceCents: number;
  keywords: string[];
}

/** Product ids are lowercase UUIDs (MIGRATION_PLAN.md D2/R18). */
export const PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** One product, or null when a required field is missing or malformed. */
export function parseProduct(value: unknown): Product | null {
  if (!isRecord(value) || !isRecord(value.rating)) return null;
  const priceCents = finite(value.priceCents);
  const stars = finite(value.rating.stars);
  const count = finite(value.rating.count);
  if (typeof value.id !== "string" || typeof value.name !== "string" || priceCents === null || stars === null || count === null) return null;
  return {
    id: value.id,
    image: text(value.image),
    name: value.name,
    description: text(value.description),
    howItWorks: text(value.howItWorks),
    highlights: strings(value.highlights),
    careInstructions: text(value.careInstructions),
    category: text(value.category),
    stock: finite(value.stock) ?? 0,
    rating: { stars, count },
    priceCents,
    keywords: strings(value.keywords),
  };
}

/** The product list; malformed entries are left out. */
export function parseProducts(data: unknown): Product[] {
  if (!Array.isArray(data)) throw new Error("The products response is not a list.");
  return data.flatMap((item) => {
    const product = parseProduct(item);
    return product ? [product] : [];
  });
}

/** A single, trimmed, bounded value from a URL search parameter. */
export function searchParam(value: string | string[] | undefined, maxLength = 100): string {
  const first = Array.isArray(value) ? value[0] : value;
  return (first ?? "").trim().slice(0, maxLength);
}

export interface CatalogFilter {
  query: string;
  category: string;
}

/** Same matching as the Vite home page: name, description, category or keywords contain the query. */
export function filterProducts(products: Product[], { query, category }: CatalogFilter): Product[] {
  const search = query.trim().toLowerCase();
  const wantedCategory = category.trim().toLowerCase();
  return products.filter((product) => (
    (!wantedCategory || product.category.toLowerCase() === wantedCategory)
    && (!search || [product.name, product.description, product.category, ...product.keywords]
      .some((value) => value.toLowerCase().includes(search)))
  ));
}

export function categoriesOf(products: Product[]): string[] {
  return [...new Set(products.map((product) => product.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Where an image is served from. The API stores paths relative to the site
 * root ("images/products/socks.jpg"); they map to /images/products/... in
 * apps/web/public. https URLs (admin-entered) are shown unoptimised; anything
 * else is not rendered.
 */
export function productImageSource(image: string): { src: string; local: boolean } | null {
  const local = /^\/?(images\/products\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp))$/i.exec(image.trim());
  if (local?.[1]) return { src: `/${local[1]}`, local: true };
  try {
    const url = new URL(image.trim());
    return url.protocol === "https:" ? { src: url.href, local: false } : null;
  } catch {
    return null;
  }
}

/** /images/ratings/rating-0.png … rating-50.png in half-star steps. */
export function ratingImageSource(stars: number): string {
  const steps = Math.min(10, Math.max(0, Math.round(stars * 2)));
  return `/images/ratings/rating-${steps * 5}.png`;
}

/** Same format as the Vite app. */
export function formatMoney(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}
