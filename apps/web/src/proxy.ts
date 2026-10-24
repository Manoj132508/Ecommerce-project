// Next.js Proxy (formerly Middleware): a Content-Security-Policy with a fresh
// nonce for every page request (lib/security/csp.ts). The request carries the
// policy so that Next.js applies the nonce while rendering; the response
// carries it so that the browser enforces it. Pages are rendered per request
// for this (the root layout awaits connection()); a prerendered page would have
// scripts without the nonce.
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/lib/security/csp";

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Not the API proxy (JSON), build assets, optimised images or public files.
      source: "/((?!api/|_next/static|_next/image|images/|favicon.ico|robots.txt|sitemap.xml).*)",
      // Link prefetches return no HTML of their own.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
