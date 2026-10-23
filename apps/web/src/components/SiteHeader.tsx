import Link from "next/link";
import { Suspense } from "react";
import { Container } from "@/components/layout/Container";
import { publicEnv } from "@/lib/env/public";
import { CurrentSearchForm, SearchForm } from "./HeaderSearch";
import { SessionStatus, SessionStatusPlaceholder } from "./SessionStatus";

/**
 * Site header. Search is a GET form to /products?q= (see HeaderSearch). The
 * search box and the session area read the URL query, so each sits in its own
 * Suspense boundary and static pages prerender the empty fallback. The header
 * is `relative` so the mobile menu panel spans its full width.
 */
export function SiteHeader() {
  return (
    <header className="relative z-30 bg-brand text-brand-foreground shadow-sm [--ring:#ffffff]">
      <Container className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3 xl:flex-nowrap">
        <Link href="/" className="focus-ring -mx-2 rounded-sm px-2 py-1.5 text-lg font-semibold tracking-tight sm:text-xl">
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
      </Container>
    </header>
  );
}
