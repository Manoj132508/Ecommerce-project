import Link from "next/link";
import { Suspense } from "react";
import { publicEnv } from "@/lib/env/public";
import { CurrentSearchForm, SearchForm } from "./HeaderSearch";
import { SessionStatus, SessionStatusPlaceholder } from "./SessionStatus";

/**
 * Site header. Search is a GET form to /products?q= (see HeaderSearch). The
 * search box and the session area read the URL query, so each sits in its own
 * Suspense boundary and static pages prerender the empty fallback.
 */
export function SiteHeader() {
  return (
    <header className="bg-[#084f2d] text-white shadow-sm">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 xl:flex-nowrap">
        <Link href="/" className="rounded px-2 py-1.5 text-lg font-bold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white sm:text-xl">
          {publicEnv.appName}
        </Link>

        <Suspense fallback={<SearchForm query="" />}>
          <CurrentSearchForm />
        </Suspense>

        <div className="ml-auto">
          <Suspense fallback={<SessionStatusPlaceholder />}>
            <SessionStatus />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
