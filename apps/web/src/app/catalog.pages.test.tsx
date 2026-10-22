// @vitest-environment jsdom
// Home, /products and /products/[productId]: the real Server Components,
// rendered with the catalogue read stubbed (no backend needed).
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PRODUCTS } from "@/test/products";
import { NotFoundSignal } from "@/test/navigation";
import { renderWithProviders } from "@/test/render";

const catalog = vi.hoisted(() => ({ getCatalog: vi.fn(), getProduct: vi.fn() }));
vi.mock("@/lib/server/catalog", () => catalog);

const { default: HomePage } = await import("./(catalog)/page");
const { default: ProductsPage, generateMetadata: productsMetadata } = await import("./products/(list)/page");
const { default: ProductPage, generateMetadata: productMetadata } = await import("./products/[productId]/page");
const { default: ProductNotFound } = await import("./products/[productId]/not-found");
const { default: NotFound } = await import("./not-found");

const params = <T extends Record<string, string>>(values: T) => Promise.resolve(values);

beforeEach(() => {
  catalog.getCatalog.mockResolvedValue(PRODUCTS);
  catalog.getProduct.mockImplementation(async (id: string) => PRODUCTS.find((product) => product.id === id) ?? null);
});

const productHeadings = () => screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);

describe("home page", () => {
  test("lists every product with links, prices, ratings and optimised images", async () => {
    renderWithProviders(await HomePage({ searchParams: params({}) }), { session: null });

    expect(screen.getByRole("heading", { level: 1, name: "Products" })).toBeInTheDocument();
    expect(productHeadings()).toEqual(PRODUCTS.map((product) => product.name));
    const card = screen.getByRole("heading", { name: "Bath Towel Set" }).closest("article");
    if (!card) throw new Error("card missing");
    expect(within(card).getByRole("link", { name: "Bath Towel Set" })).toHaveAttribute("href", `/products/${PRODUCTS[1]?.id}`);
    expect(within(card).getByText("$22.99")).toBeInTheDocument();
    expect(within(card).getByAltText("4 out of 5 stars")).toHaveAttribute("src", "/images/ratings/rating-40.png");

    const photo = within(card).getByAltText("Bath Towel Set");
    expect(photo).toHaveAttribute("src", "/images/products/bath-towel-set-gray-rosewood.jpg");
    expect(photo).toHaveAttribute("data-sizes", expect.stringContaining("180px"));
    expect(photo).toHaveAttribute("data-unoptimized", "false");
  });

  test("only the first row of images is preloaded; the rest load lazily", async () => {
    renderWithProviders(await HomePage({ searchParams: params({}) }), { session: null });
    const preload = PRODUCTS.map((product) => screen.getByAltText(product.name).getAttribute("data-preload"));
    expect(preload).toEqual(["true", "true", "true", "true", "false"]);
  });

  test("search from the URL filters the products", async () => {
    renderWithProviders(await HomePage({ searchParams: params({ q: "sun" }) }), { session: null });
    expect(screen.getByRole("heading", { level: 1, name: "Search results" })).toBeInTheDocument();
    expect(productHeadings()).toEqual(["Round Sunglasses", "Straw Sunhat"]);
    expect(screen.getByRole("status")).toHaveTextContent("2 results for “sun”");
  });

  test("no match shows a way back to every product", async () => {
    renderWithProviders(await HomePage({ searchParams: params({ q: "nothing-like-this" }) }), { session: null });
    expect(screen.getByText(/No products match your search/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all products" })).toHaveAttribute("href", "/");
  });
});

describe("/products", () => {
  test("category filter links keep the search and mark the current category", async () => {
    renderWithProviders(await ProductsPage({ searchParams: params({ category: "accessories", q: "hat" }) }), { session: null });
    expect(productHeadings()).toEqual(["Straw Sunhat"]);
    const categories = screen.getByRole("navigation", { name: "Categories" });
    expect(within(categories).getByRole("link", { name: "Accessories" })).toHaveAttribute("aria-current", "page");
    expect(within(categories).getByRole("link", { name: "Kitchen" })).toHaveAttribute("href", "/products?q=hat&category=Kitchen");
    expect(within(categories).getByRole("link", { name: "All" })).toHaveAttribute("href", "/products?q=hat");
  });

  test("metadata: listing is indexable, search results are not", async () => {
    expect(await productsMetadata({ searchParams: params({}) })).toMatchObject({ title: "All products", alternates: { canonical: "/products" } });
    expect(await productsMetadata({ searchParams: params({ q: "socks" }) })).toMatchObject({ title: "Search: socks", robots: { index: false } });
  });

  test("the add-to-cart controls return to the filtered listing after sign-in", async () => {
    const { user } = renderWithProviders(await ProductsPage({ searchParams: params({ q: "towel" }) }), { session: null });
    await user.click(screen.getByRole("button", { name: "Add Bath Towel Set to cart" }));
    const { navigation } = await import("@/test/navigation");
    expect(navigation.push).toHaveBeenCalledWith(`/login?from=${encodeURIComponent("/products?q=towel")}`);
  });
});

describe("/products/[productId]", () => {
  const product = PRODUCTS[2];
  if (!product) throw new Error("fixture missing");

  test("renders the product with details, a preloaded image and structured data", async () => {
    const { container } = renderWithProviders(await ProductPage({ params: params({ productId: product.id }) }), { session: null });
    expect(screen.getByRole("heading", { level: 1, name: "Espresso Maker" })).toBeInTheDocument();
    expect(screen.getByText("$89.99")).toBeInTheDocument();
    expect(screen.getByText("3 ratings")).toBeInTheDocument();
    expect(screen.getByAltText("5 out of 5 stars")).toHaveAttribute("src", "/images/ratings/rating-50.png");
    expect(screen.getByRole("heading", { name: "About this product" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Product highlights" })).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity:")).toHaveValue("1");
    expect(screen.getByAltText("Espresso Maker")).toHaveAttribute("data-preload", "true");
    expect(screen.getByRole("link", { name: /Back to products/ })).toHaveAttribute("href", "/products");

    const jsonLd = container.querySelector('script[type="application/ld+json"]')?.textContent ?? "";
    expect(JSON.parse(jsonLd)).toMatchObject({ "@type": "Product", name: "Espresso Maker", offers: { price: "89.99", priceCurrency: "USD" } });
  });

  test("structured data cannot break out of its script tag", async () => {
    catalog.getProduct.mockResolvedValueOnce({ ...product, name: "</script><script>alert(1)</script>" });
    const { container } = renderWithProviders(await ProductPage({ params: params({ productId: product.id }) }), { session: null });
    const jsonLd = container.querySelector('script[type="application/ld+json"]')?.textContent ?? "";
    expect(jsonLd).not.toContain("</script>");
    expect(JSON.parse(jsonLd).name).toBe("</script><script>alert(1)</script>");
  });

  test.each(["00000000-0000-4000-8000-000000000000", "not-a-product-id"])("a missing product (%s) is a 404", async (productId) => {
    await expect(ProductPage({ params: params({ productId }) })).rejects.toBeInstanceOf(NotFoundSignal);
    expect(await productMetadata({ params: params({ productId }) })).toMatchObject({ title: "Product not found", robots: { index: false } });
  });

  test("metadata uses the product for title, description, canonical URL and preview image", async () => {
    expect(await productMetadata({ params: params({ productId: product.id }) })).toMatchObject({
      title: "Espresso Maker",
      description: "Strong coffee.",
      alternates: { canonical: `/products/${product.id}` },
      openGraph: { images: [{ url: "/images/products/black-and-silver-espresso-maker.jpg", width: 720, height: 720 }] },
    });
  });
});

describe("not-found pages", () => {
  test("product and site 404 pages offer a way back", () => {
    renderWithProviders(<ProductNotFound />);
    expect(screen.getByRole("heading", { name: "Product not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to products" })).toHaveAttribute("href", "/products");
  });

  test("unknown pages", () => {
    renderWithProviders(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
