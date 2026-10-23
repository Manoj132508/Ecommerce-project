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

/** Sort orders for ?sort= (P4). An empty value keeps the catalogue's own order. */
export const SORT_OPTIONS = [
  { value: "", label: "Catalogue order" },
  { value: "name-asc", label: "Name: A to Z" },
  { value: "name-desc", label: "Name: Z to A" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
] as const;

export type SortOrder = (typeof SORT_OPTIONS)[number]["value"];

/** A known sort order, or "" for anything else (unknown values are ignored, not an error). */
export function parseSort(value: string): SortOrder {
  return SORT_OPTIONS.find((option) => option.value === value)?.value ?? "";
}

export function sortLabel(sort: SortOrder): string {
  return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "";
}

// A fixed locale, so server and client agree; "Item 2" sorts before "Item 10".
const names = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const byName = (a: Product, b: Product) => names.compare(a.name, b.name);
const byPrice = (a: Product, b: Product) => a.priceCents - b.priceCents;
const byId = (a: Product, b: Product) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A sorted copy. Ties are broken deterministically: equal names by price (low
 * first), equal prices by name (A to Z), and finally by id, so the order never
 * depends on the API's row order.
 */
export function sortProducts(products: Product[], sort: SortOrder): Product[] {
  const compare: Record<Exclude<SortOrder, "">, (a: Product, b: Product) => number> = {
    "name-asc": (a, b) => byName(a, b) || byPrice(a, b) || byId(a, b),
    "name-desc": (a, b) => byName(b, a) || byPrice(a, b) || byId(a, b),
    "price-asc": (a, b) => byPrice(a, b) || byName(a, b) || byId(a, b),
    "price-desc": (a, b) => byPrice(b, a) || byName(a, b) || byId(a, b),
  };
  return sort ? [...products].sort(compare[sort]) : [...products];
}

/**
 * Highest average rating first, then the most ratings, then name and id.
 * Products nobody has rated are left out: "top rated" means rated.
 */
export function topRated(products: Product[], limit: number): Product[] {
  return products
    .filter((product) => product.rating.count > 0)
    .sort((a, b) => b.rating.stars - a.rating.stars || b.rating.count - a.rating.count || byName(a, b) || byId(a, b))
    .slice(0, limit);
}

export interface CategorySummary {
  name: string;
  count: number;
  /** The category's top-rated product (or its first one), whose photo represents it. */
  cover: Product;
}

/** Each category with its product count, in the same order as the category chips. */
export function categorySummaries(products: Product[]): CategorySummary[] {
  return categoriesOf(products).flatMap((name) => {
    const members = products.filter((product) => product.category.trim().toLowerCase() === name.toLowerCase());
    const cover = topRated(members, 1)[0] ?? members[0];
    return cover ? [{ name, count: members.length, cover }] : [];
  });
}

export interface CatalogParams {
  query?: string;
  category?: string;
  sort?: SortOrder;
}

/** A listing URL; parameters keep the order q, category, sort and empty ones are left out. */
export function catalogHref(basePath: string, { query = "", category = "", sort = "" }: CatalogParams): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category) params.set("category", category);
  if (sort) params.set("sort", sort);
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
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
