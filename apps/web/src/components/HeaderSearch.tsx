"use client";

import Form from "next/form";
import { useSearchParams } from "next/navigation";
import { SearchIcon } from "@/components/ui/icons";

/**
 * GET form to /products?q= (works without JavaScript; next/form navigates
 * client-side when it can). `key` resets the field when the URL query changes,
 * so the box always shows the search being displayed, as the Vite header did.
 */
export function SearchForm({ query }: { query: string }) {
  return (
    <Form key={query} action="/products" role="search" className="order-3 flex w-full items-stretch xl:order-none xl:mx-4 xl:max-w-2xl xl:flex-1">
      <label htmlFor="site-search" className="sr-only">Search products</label>
      <input
        id="site-search"
        name="q"
        type="search"
        placeholder="Search products"
        defaultValue={query}
        maxLength={100}
        className="focus-ring min-h-11 min-w-0 flex-1 rounded-l-md border-0 bg-background px-4 text-base text-foreground placeholder:text-muted-foreground lg:min-h-10"
      />
      <button
        type="submit"
        className="focus-ring inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-r-md bg-accent px-4 font-semibold text-accent-foreground hover:bg-white"
      >
        <SearchIcon className="size-4" />
        Search
      </button>
    </Form>
  );
}

/** The search form filled with the current ?q= (needs a Suspense boundary). */
export function CurrentSearchForm() {
  return <SearchForm query={(useSearchParams().get("q") ?? "").trim().slice(0, 100)} />;
}
