import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env/public";

// Customer pages are private (they also send noindex and no-store); the API is
// not for crawlers. The sitemap is announced only when the public origin is known.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/account", "/cart", "/checkout", "/orders", "/tracking", "/login", "/register", "/admin"],
    }],
    ...(publicEnv.siteUrl ? { sitemap: new URL("/sitemap.xml", publicEnv.siteUrl).href } : {}),
  };
}
