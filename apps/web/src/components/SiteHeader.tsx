import Form from "next/form";
import Link from "next/link";
import { publicEnv } from "@/lib/env/public";
import { SessionStatus } from "./SessionStatus";

/**
 * Site header. Search is a GET form to /products?q= (works without
 * JavaScript; next/form navigates client-side when it is available).
 */
export function SiteHeader() {
  return (
    <header className="bg-[#084f2d] text-white shadow-sm">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 xl:flex-nowrap">
        <Link href="/" className="rounded px-2 py-1.5 text-lg font-bold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white sm:text-xl">
          {publicEnv.appName}
        </Link>

        <Form action="/products" role="search" className="order-3 flex w-full items-center xl:order-none xl:mx-2 xl:max-w-[850px] xl:flex-1">
          <label htmlFor="site-search" className="sr-only">Search products</label>
          <input
            id="site-search"
            name="q"
            type="search"
            placeholder="Search products"
            maxLength={100}
            className="h-10 min-w-0 flex-1 rounded-l-md border-0 bg-white px-3 text-base text-[#212121] focus-visible:outline-2 focus-visible:outline-[#baffbe]"
          />
          <button type="submit" className="h-10 shrink-0 rounded-r-md bg-[#baffbe] px-4 font-semibold text-[#084f2d] hover:bg-[#a3f0a8] focus-visible:outline-2 focus-visible:outline-white">
            Search
          </button>
        </Form>

        <nav aria-label="Account" className="ml-auto">
          <SessionStatus />
        </nav>
      </div>
    </header>
  );
}
