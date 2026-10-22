// robots.txt and sitemap.xml with a configured public origin.
import { describe, expect, test, vi } from "vitest";
import { CatalogUnavailableError } from "@/lib/server/catalog";
import { PRODUCTS } from "@/test/products";

const catalog = vi.hoisted(() => ({ getCatalog: vi.fn() }));
vi.mock("@/lib/server/catalog", async (original) => ({ ...(await original<object>()), getCatalog: catalog.getCatalog }));
vi.mock("@/lib/env/public", () => ({ publicEnv: { appName: "Shop", siteUrl: new URL("https://shop.example.com") } }));

describe("robots.txt", () => {
  test("keeps crawlers out of private pages and the API, and names the sitemap", async () => {
    const { default: robots } = await import("./robots");
    expect(robots()).toEqual({
      rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/cart", "/checkout", "/orders", "/tracking", "/login", "/register"] }],
      sitemap: "https://shop.example.com/sitemap.xml",
    });
  });
});

describe("sitemap.xml", () => {
  test("lists the catalogue pages and every product with absolute URLs", async () => {
    catalog.getCatalog.mockResolvedValueOnce(PRODUCTS);
    const { default: sitemap } = await import("./sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toEqual([
      "https://shop.example.com/",
      "https://shop.example.com/products",
      ...PRODUCTS.map((product) => `https://shop.example.com/products/${product.id}`),
    ]);
  });

  test("still answers with the fixed pages when the catalogue is unavailable", async () => {
    catalog.getCatalog.mockRejectedValueOnce(new CatalogUnavailableError());
    const { default: sitemap } = await import("./sitemap");
    expect((await sitemap()).map((entry) => entry.url)).toEqual(["https://shop.example.com/", "https://shop.example.com/products"]);
  });
});
