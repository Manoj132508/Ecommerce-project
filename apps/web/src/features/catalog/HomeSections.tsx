import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Price } from "./Price";
import { ProductImage, RatingStars } from "./ProductImage";
import { catalogHref, type CategorySummary, type Product } from "./product";

const list = new Intl.ListFormat("en", { type: "conjunction" });

/** "Accessories, Footwear and Home"; long lists end with "and more". */
export function describeCategories(names: string[], max = 4): string {
  if (names.length <= max) return list.format(names);
  return `${names.slice(0, max - 1).join(", ")} and more`;
}

/**
 * Home hero on the brand green: what the store sells (counted from the
 * catalogue, nothing invented) and the highest-rated product as a spotlight.
 */
export function HomeHero({ productCount, categories, spotlight }: {
  productCount: number;
  categories: string[];
  spotlight?: Product;
}) {
  return (
    <section aria-labelledby="home-title" className="overflow-hidden rounded-lg bg-brand text-brand-foreground [--ring:#ffffff]">
      <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1.15fr_1fr] lg:gap-12 lg:p-12">
        <div>
          <p className="text-sm font-semibold text-white/85">
            {productCount} product{productCount === 1 ? "" : "s"}
            {categories.length > 0 && ` · ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`}
          </p>
          <h1 id="home-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
            Shop everyday essentials
          </h1>
          <p className="mt-4 max-w-xl text-base text-white/85 sm:text-lg">
            {categories.length > 0 ? `Browse ${describeCategories(categories)}. ` : ""}
            Search by name, filter by category and sort by name or price.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/products" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "text-brand")}>
              Shop all products
            </Link>
            {categories.length > 0 && (
              <Link href="#categories" className={cn(buttonVariants({ variant: "inverse", size: "lg" }), "border border-white/50")}>
                Browse categories
              </Link>
            )}
          </div>
        </div>

        {spotlight && <Spotlight product={spotlight} />}
      </div>
    </section>
  );
}

function Spotlight({ product }: { product: Product }) {
  const href = `/products/${encodeURIComponent(product.id)}`;
  return (
    <div className="mx-auto grid w-full max-w-md gap-4 rounded-md bg-card p-4 text-card-foreground shadow-lg sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:p-5 lg:max-w-none">
      <Link href={href} tabIndex={-1} aria-hidden="true" className="block rounded-sm bg-surface p-4">
        {/* The largest image above the fold on the home page. */}
        <ProductImage product={product} sizes="(min-width: 1024px) 240px, (min-width: 640px) 200px, 70vw" preload className="mx-auto w-full max-w-[220px]" />
      </Link>
      <div className="flex min-w-0 flex-col justify-center gap-2">
        <Badge variant="secondary" className="w-fit px-2.5 py-0.5">Top rated</Badge>
        <h2 className="text-lg font-semibold leading-snug">
          <Link href={href} className="focus-ring rounded-sm hover:text-primary hover:underline hover:underline-offset-4">{product.name}</Link>
        </h2>
        {product.category && <p className="text-sm text-muted-foreground">{product.category}</p>}
        <RatingStars stars={product.rating.stars} count={product.rating.count} label=" ratings" />
        <Price cents={product.priceCents} />
      </div>
    </div>
  );
}

/** One card per category, linking to the filtered listing; the photo is its top-rated product. */
export function CategoryGrid({ categories }: { categories: CategorySummary[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {categories.map(({ name, count, cover }) => (
        <li key={name}>
          <Link
            href={catalogHref("/products", { category: name })}
            className="group focus-ring flex h-full flex-col rounded-md border border-border bg-card p-3 shadow-xs transition-shadow hover:shadow-md sm:p-4"
          >
            <span className="block overflow-hidden rounded-sm bg-surface p-3">
              <ProductImage
                product={cover}
                decorative
                sizes="(min-width: 1024px) 200px, (min-width: 640px) 28vw, 40vw"
                className="mx-auto w-full max-w-[160px] transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </span>
            <span className="mt-3 font-semibold group-hover:text-primary">{name}</span>
            <span className="text-sm text-muted-foreground">{count} product{count === 1 ? "" : "s"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Section heading row: title, optional description and a link on the right. */
export function SectionHeader({ id, title, description, action }: { id: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id={id} className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
