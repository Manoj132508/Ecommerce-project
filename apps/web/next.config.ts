import type { NextConfig } from "next";

// The browser only ever talks to this host. /api/* is forwarded to Express by
// the route handler in src/app/api/[...path]/route.ts (not by rewrites), so the
// forwarded headers and cookies are explicitly controlled.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // The optimiser only serves files under public/images (product photos and
    // rating stars), never query-string variants, and fetches no remote hosts.
    // Off-site https product images are rendered unoptimised instead.
    localPatterns: [{ pathname: "/images/**", search: "" }],
    remotePatterns: [],
    // Catalogue photos are 720×720: no 2K/4K variants are useful.
    deviceSizes: [640, 750, 828, 1080],
    imageSizes: [96, 128, 160, 192, 256, 384],
  },
  // Vite routes whose job moved: the details form and confirmation are the
  // checkout review step, and a deleted product is explained on the order
  // line itself. Temporary (307) while the Vite app is still live.
  async redirects() {
    return [
      { source: "/order-confirmation", destination: "/checkout", permanent: false },
      { source: "/product-unavailable", destination: "/orders", permanent: false },
      // Until Phase 6B the home page was the listing; its ?q=, ?category= and
      // ?sort= links now open /products (the query string is passed along).
      // Here rather than in the page: the home route streams behind a loading
      // skeleton, so a redirect from the page would arrive after a 200.
      ...["q", "category", "sort"].map((key) => (
        { source: "/", has: [{ type: "query" as const, key }], destination: "/products", permanent: false }
      )),
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
