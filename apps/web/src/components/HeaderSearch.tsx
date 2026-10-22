"use client";

import Form from "next/form";
import { useSearchParams } from "next/navigation";

/**
 * GET form to /products?q= (works without JavaScript; next/form navigates
 * client-side when it can). `key` resets the field when the URL query changes,
 * so the box always shows the search being displayed, as the Vite header did.
 */
export function SearchForm({ query }: { query: string }) {
  return (
    <Form key={query} action="/products" role="search" className="order-3 flex w-full items-center xl:order-none xl:mx-2 xl:max-w-[850px] xl:flex-1">
      <label htmlFor="site-search" className="sr-only">Search products</label>
      <input
        id="site-search"
        name="q"
        type="search"
        placeholder="Search products"
        defaultValue={query}
        maxLength={100}
        className="h-10 min-w-0 flex-1 rounded-l-md border-0 bg-white px-3 text-base text-[#212121] focus-visible:outline-2 focus-visible:outline-[#baffbe]"
      />
      <button type="submit" className="h-10 shrink-0 rounded-r-md bg-[#baffbe] px-4 font-semibold text-[#084f2d] hover:bg-[#a3f0a8] focus-visible:outline-2 focus-visible:outline-white">
        Search
      </button>
    </Form>
  );
}

/** The search form filled with the current ?q= (needs a Suspense boundary). */
export function CurrentSearchForm() {
  return <SearchForm query={(useSearchParams().get("q") ?? "").trim().slice(0, 100)} />;
}
