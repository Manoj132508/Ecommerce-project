import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PRODUCTS } from "@/test/products";
import {
  catalogHref,
  categoriesOf,
  categorySummaries,
  filterProducts,
  formatMoney,
  parseProduct,
  parseProducts,
  parseSort,
  productImageSource,
  ratingImageSource,
  searchParam,
  sortProducts,
  topRated,
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

describe("sorting (?sort=)", () => {
  const product = (id: string, name: string, priceCents: number, stars = 4, count = 1) => ({ ...PRODUCTS[0]!, id, name, priceCents, rating: { stars, count } });
  const ids = (list: { id: string }[]) => list.map((item) => item.id);

  test("only the four known orders are accepted; anything else keeps the catalogue order", () => {
    expect(["name-asc", "name-desc", "price-asc", "price-desc"].map(parseSort)).toEqual(["name-asc", "name-desc", "price-asc", "price-desc"]);
    expect(["", "price", "PRICE-ASC", "rating", "name-asc "].map(parseSort)).toEqual(["", "", "", "", ""]);
    expect(ids(sortProducts(PRODUCTS, ""))).toEqual(ids(PRODUCTS));
  });

  test("name and price orders over the real fixture data", () => {
    const names = (sort: Parameters<typeof sortProducts>[1]) => sortProducts(PRODUCTS, sort).map((item) => item.name);
    expect(names("name-asc")).toEqual(["Athletic Skateboard Shoes", "Bath Towel Set", "Espresso Maker", "Round Sunglasses", "Straw Sunhat"]);
    expect(names("name-desc")).toEqual(["Straw Sunhat", "Round Sunglasses", "Espresso Maker", "Bath Towel Set", "Athletic Skateboard Shoes"]);
    expect(names("price-asc")).toEqual(["Round Sunglasses", "Straw Sunhat", "Bath Towel Set", "Athletic Skateboard Shoes", "Espresso Maker"]);
    expect(names("price-desc")).toEqual(["Espresso Maker", "Athletic Skateboard Shoes", "Bath Towel Set", "Straw Sunhat", "Round Sunglasses"]);
  });

  test("ties are broken deterministically, whatever order the API returned", () => {
    const list = [product("c", "Mug", 500), product("a", "mug", 500), product("b", "Bowl", 500), product("d", "Mug", 300)];
    for (const input of [list, [...list].reverse()]) {
      // Same price: by name (case-insensitive), then id.
      expect(ids(sortProducts(input, "price-asc"))).toEqual(["d", "b", "a", "c"]);
      expect(ids(sortProducts(input, "price-desc"))).toEqual(["b", "a", "c", "d"]);
      // Same name: cheaper first, then id — in both name directions.
      expect(ids(sortProducts(input, "name-asc"))).toEqual(["b", "d", "a", "c"]);
      expect(ids(sortProducts(input, "name-desc"))).toEqual(["d", "a", "c", "b"]);
    }
  });

  test("numbers in names sort naturally and the input is not changed", () => {
    const list = [product("x", "Item 10", 1), product("y", "Item 2", 1)];
    expect(ids(sortProducts(list, "name-asc"))).toEqual(["y", "x"]);
    expect(ids(list)).toEqual(["x", "y"]);
  });
});

describe("home page selections", () => {
  test("top rated: highest average, then most ratings; unrated products are left out", () => {
    const unrated = { ...PRODUCTS[0]!, id: "z", name: "New", rating: { stars: 0, count: 0 } };
    expect(topRated([...PRODUCTS, unrated], 3).map((item) => item.name)).toEqual(["Espresso Maker", "Athletic Skateboard Shoes", "Straw Sunhat"]);
    expect(topRated([unrated], 4)).toEqual([]);
  });

  test("categories with counts and the top-rated product as the cover photo", () => {
    expect(categorySummaries(PRODUCTS).map(({ name, count, cover }) => [name, count, cover.name])).toEqual([
      ["Accessories", 2, "Straw Sunhat"],
      ["Footwear", 1, "Athletic Skateboard Shoes"],
      ["Home", 1, "Bath Towel Set"],
      ["Kitchen", 1, "Espresso Maker"],
    ]);
  });

  test("listing URLs keep the order q, category, sort and leave out empty values", () => {
    expect(catalogHref("/products", {})).toBe("/products");
    expect(catalogHref("/products", { sort: "price-asc" })).toBe("/products?sort=price-asc");
    expect(catalogHref("/products", { query: "sun hat", category: "Home & Garden", sort: "name-desc" })).toBe("/products?q=sun+hat&category=Home+%26+Garden&sort=name-desc");
  });
});
