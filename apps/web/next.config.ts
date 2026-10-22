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
