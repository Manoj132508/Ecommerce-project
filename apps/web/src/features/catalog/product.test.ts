import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PRODUCTS } from "@/test/products";
import {
  categoriesOf,
  filterProducts,
  formatMoney,
  parseProduct,
  parseProducts,
  productImageSource,
  ratingImageSource,
  searchParam,
} from "./product";

describe("parsing API products", () => {
  test("keeps valid products and applies the MongoDB defaults for optional fields", () => {
    const product = parseProduct({ id: "p", name: "Socks", priceCents: 1090, rating: { stars: 4.5, count: 87 }, image: "images/products/x.jpg", extra: "dropped" });
    expect(product).toEqual({
      id: "p", image: "images/products/x.jpg", name: "Socks", description: "", howItWorks: "", highlights: [], careInstructions: "",
      category: "", stock: 0, rating: { stars: 4.5, count: 87 }, priceCents: 1090, keywords: [],
    });
  });

  test("drops malformed entries; a non-list response is an error", () => {
    expect(parseProducts([{ id: "a" }, null, { id: "b", name: "B", priceCents: "1", rating: { stars: 1, count: 1 } }, PRODUCTS[0]])).toEqual([PRODUCTS[0]]);
    expect(() => parseProducts({ products: [] })).toThrow(/not a list/);
  });
});

describe("search and filters (same matching as the Vite home page)", () => {
  test.each([
    ["", "", 5],
    ["towel", "", 1],
    ["COFFEE", "", 1],
    ["accessories", "", 2],
    ["sun", "", 2],
    ["", "Accessories", 2],
    ["", "accessories", 2],
    ["hat", "Accessories", 1],
    ["hat", "Kitchen", 0],
    ["nothing-matches", "", 0],
  ])("query %j, category %j → %i products", (query, category, count) => {
    expect(filterProducts(PRODUCTS, { query, category })).toHaveLength(count);
  });

  test("categories are unique and sorted", () => {
    expect(categoriesOf(PRODUCTS)).toEqual(["Accessories", "Footwear", "Home", "Kitchen"]);
  });

  test("search parameters: first value, trimmed, bounded", () => {
    expect(searchParam(undefined)).toBe("");
    expect(searchParam(["  socks ", "ignored"])).toBe("socks");
    expect(searchParam("x".repeat(500))).toHaveLength(100);
  });
});

describe("image paths", () => {
  test("catalogue paths map to /images/products and every fixture file exists", () => {
    for (const product of PRODUCTS) {
      const source = productImageSource(product.image);
      expect(source?.local).toBe(true);
      expect(existsSync(`public${source?.src ?? ""}`)).toBe(true);
    }
    expect(productImageSource("/images/products/socks.jpg")).toEqual({ src: "/images/products/socks.jpg", local: true });
  });

  test.each([
    "images/products/../../.env",
    "images/products/sub/dir.jpg",
    "images/products/socks.svg",
    "images/ratings/rating-45.png",
    "http://cdn.example/socks.jpg",
    "javascript:alert(1)",
    "//evil.example/socks.jpg",
    "",
  ])("refuses %j", (image) => {
    expect(productImageSource(image)).toBeNull();
  });

  test("off-site https images are allowed but not optimised", () => {
    expect(productImageSource("https://cdn.example/socks.jpg")).toEqual({ src: "https://cdn.example/socks.jpg", local: false });
  });

  test("ratings map to the half-star images, clamped", () => {
    expect(ratingImageSource(4.5)).toBe("/images/ratings/rating-45.png");
    expect(ratingImageSource(0)).toBe("/images/ratings/rating-0.png");
    expect(ratingImageSource(9)).toBe("/images/ratings/rating-50.png");
    for (let steps = 0; steps <= 10; steps += 1) {
      expect(existsSync(`public${ratingImageSource(steps / 2)}`)).toBe(true);
    }
  });

  test("money is formatted like the Vite app", () => {
    expect(formatMoney(1090)).toBe("$10.90");
    expect(formatMoney(0)).toBe("$0.00");
  });
});
