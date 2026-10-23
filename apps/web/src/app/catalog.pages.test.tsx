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

const { default: HomePage, generateMetadata: homeMetadata } = await import("./(catalog)/page");
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
  test("hero counts the real catalogue and spotlights the highest-rated product", async () => {
    renderWithProviders(await HomePage({ searchParams: params({}) }), { session: null });

    const hero = screen.getByRole("region", { name: "Shop everyday essentials" });
    expect(within(hero).getByRole("heading", { level: 1 })).toHaveTextContent("Shop everyday essentials");
    expect(within(hero).getByText("5 products · 4 categories")).toBeInTheDocument();
    expect(within(hero).getByText(/Browse Accessories, Footwear, Home, and Kitchen\./)).toBeInTheDocument();
    expect(within(hero).getByRole("link", { name: "Shop all products" })).toHaveAttribute("href", "/products");
    expect(within(hero).getByRole("link", { name: "Browse categories" })).toHaveAttribute("href", "#categories");
    // Espresso Maker: 5 stars, the highest average in the fixtures. Its photo is the preloaded hero image.
    expect(within(hero).getByRole("link", { name: "Espresso Maker" })).toHaveAttribute("href", `/products/${PRODUCTS[2]?.id}`);
    expect(within(hero).getByAltText("Espresso Maker")).toHaveAttribute("data-preload", "true");
    expect(within(hero).getByText("$89.99")).toBeInTheDocument();
  });

  test("category cards link to the filtered listing, named by category and count", async () => {
    renderWithProviders(await HomePage({ searchParams: params({}) }), { session: null });
    const section = screen.getByRole("region", { name: "Shop by category" });
    const links = within(section).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Accessories2 products", "/products?category=Accessories"],
      ["Footwear1 product", "/products?category=Footwear"],
      ["Home1 product", "/products?category=Home"],
      ["Kitchen1 product", "/products?category=Kitchen"],
    ]);
    // The cover photos are decorative, so each link is named by its text only.
    expect(section.querySelectorAll("img").length).toBe(4);
    expect([...section.querySelectorAll("img")].every((image) => image.getAttribute("alt") === "")).toBe(true);
  });

  test("top rated row: four products as h3 cards, lazily loaded, with add to cart returning home", async () => {
    const { user } = renderWithProviders(await HomePage({ searchParams: params({}) }), { session: null });
    const section = screen.getByRole("region", { name: "Top rated" });
    expect(within(section).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["Espresso Maker", "Athletic Skateboard Shoes", "Straw Sunhat", "Bath Towel Set"]);
    expect([...section.querySelectorAll("img[data-sizes]")].map((image) => image.getAttribute("data-preload")))
      .toEqual(["false", "false", "false", "false"]);
    await user.click(within(section).getByRole("button", { name: "Add Straw Sunhat to cart" }));
    const { navigation } = await import("@/test/navigation");
    expect(navigation.push).toHaveBeenCalledWith(`/login?from=${encodeURIComponent("/")}`);
  });

  test("old listing links on the home page are temporary redirects to /products (query passed along)", async () => {
    const { default: config } = await import("../../next.config");
    const redirects = await config.redirects?.();
    expect(redirects?.filter((rule) => rule.source === "/")).toEqual(["q", "category", "sort"].map((key) => (
      { source: "/", has: [{ type: "query", key }], destination: "/products", permanent: false }
    )));
  });

  test("an empty catalogue says so instead of showing empty sections", async () => {
    catalog.getCatalog.mockResolvedValue([]);
    renderWithProviders(await HomePage({ searchParams: params({}) }), { session: null });
    expect(screen.getByRole("heading", { name: "No products yet" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Top rated" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Browse categories" })).not.toBeInTheDocument();
  });

  test("metadata: canonical home URL and a description from the real categories", async () => {
    expect(await homeMetadata({ searchParams: params({}) })).toMatchObject({ alternates: { canonical: "/" }, description: expect.stringContaining("Accessories, Footwear, Home, and Kitchen") });
  });
});

describe("/products listing", () => {
  test("lists every product with links, prices, ratings and optimised images", async () => {
    renderWithProviders(await ProductsPage({ searchParams: params({}) }), { session: null });

    expect(screen.getByRole("heading", { level: 1, name: "All products" })).toBeInTheDocument();
    expect(productHeadings()).toEqual(PRODUCTS.map((product) => product.name));
    const card = screen.getByRole("heading", { name: "Bath Towel Set" }).closest("article");
    if (!card) throw new Error("card missing");
    expect(within(card).getByRole("link", { name: "Bath Towel Set" })).toHaveAttribute("href", `/products/${PRODUCTS[1]?.id}`);
    expect(within(card).getByText("$22.99")).toBeInTheDocument();
    expect(within(card).getByText("Home")).toBeInTheDocument();
    expect(within(card).getByAltText("4 out of 5 stars")).toHaveAttribute("src", "/images/ratings/rating-40.png");

    const photo = within(card).getByAltText("Bath Towel Set");
    expect(photo).toHaveAttribute("src", "/images/products/bath-towel-set-gray-rosewood.jpg");
    expect(photo).toHaveAttribute("data-sizes", expect.stringContaining("220px"));
    expect(photo).toHaveAttribute("data-unoptimized", "false");
  });

  test("only the first row of images is preloaded; the rest load lazily", async () => {
    renderWithProviders(await ProductsPage({ searchParams: params({}) }), { session: null });
    const preload = PRODUCTS.map((product) => screen.getByAltText(product.name).getAttribute("data-preload"));
    expect(preload).toEqual(["true", "true", "true", "true", "false"]);
  });

  test("search from the URL filters the products", async () => {
    renderWithProviders(await ProductsPage({ searchParams: params({ q: "sun" }) }), { session: null });
    expect(screen.getByRole("heading", { level: 1, name: "Search results" })).toBeInTheDocument();
    expect(productHeadings()).toEqual(["Round Sunglasses", "Straw Sunhat"]);
    expect(screen.getByRole("status")).toHaveTextContent("2 results for “sun”");
  });

  test("no match explains why and offers a way back to every product", async () => {
    renderWithProviders(await ProductsPage({ searchParams: params({ q: "nothing-like-this", category: "Kitchen" }) }), { session: null });
    expect(screen.getByRole("heading", { name: "No products found" })).toBeInTheDocument();
    expect(screen.getByText(/No products match “nothing-like-this” in Kitchen/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all products" })).toHaveAttribute("href", "/products");
    expect(screen.getByRole("link", { name: "Search all categories" })).toHaveAttribute("href", "/products?q=nothing-like-this");
  });

  test("sort order from the URL: products, status text and the selected option", async () => {
    renderWithProviders(await ProductsPage({ searchParams: params({ sort: "price-desc" }) }), { session: null });
    expect(productHeadings()).toEqual(["Espresso Maker", "Athletic Skateboard Shoes", "Bath Towel Set", "Straw Sunhat", "Round Sunglasses"]);
    expect(screen.getByRole("status")).toHaveTextContent("5 products, sorted by price: high to low");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("price-desc");
  });

  test("an unknown sort value is ignored", async () => {
    renderWithProviders(await ProductsPage({ searchParams: params({ sort: "cheapest" }) }), { session: null });
    expect(productHeadings()).toEqual(PRODUCTS.map((product) => product.name));
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("");
  });

  test("choosing a sort order navigates (a history entry) and keeps the search and category", async () => {
    const { user } = renderWithProviders(await ProductsPage({ searchParams: params({ q: "s", category: "Accessories" }) }), { session: null });
    const select = screen.getByRole("combobox", { name: "Sort by" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Catalogue order", "Name: A to Z", "Name: Z to A", "Price: low to high", "Price: high to low"]);
    // Hydrated: no Apply button; it is only there for browsers without JavaScript.
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    await user.selectOptions(select, "name-desc");
    const { navigation } = await import("@/test/navigation");
    expect(navigation.push).toHaveBeenCalledWith("/products?q=s&category=Accessories&sort=name-desc", { scroll: false });
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test("without JavaScript the sort form submits the same parameters", async () => {
    renderWithProviders(await ProductsPage({ searchParams: params({ q: "s", category: "Accessories", sort: "price-asc" }) }), { session: null });
    const form = screen.getByRole("combobox", { name: "Sort by" }).closest("form");
    if (!form) throw new Error("form missing");
    expect(form).toHaveAttribute("action", "/products");
    expect(form).toHaveAttribute("method", "get");
    expect(Object.fromEntries(new FormData(form))).toEqual({ q: "s", category: "Accessories", sort: "price-asc" });
  });

  test("category links keep the sort order", async () => {
    renderWithProviders(await ProductsPage({ searchParams: params({ sort: "name-asc" }) }), { session: null });
    const categories = screen.getByRole("navigation", { name: "Categories" });
    expect(within(categories).getByRole("link", { name: "Kitchen" })).toHaveAttribute("href", "/products?category=Kitchen&sort=name-asc");
    expect(within(categories).getByRole("link", { name: "All" })).toHaveAttribute("href", "/products?sort=name-asc");
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
    expect(screen.getByLabelText("Quantity")).toHaveValue("1");
    expect(screen.getByAltText("Espresso Maker")).toHaveAttribute("data-preload", "true");
    expect(screen.getByRole("button", { name: /Add to Cart/ })).toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Home", "/"], ["Products", "/products"], ["Kitchen", "/products?category=Kitchen"],
    ]);
    expect(within(breadcrumb).getByText("Espresso Maker")).toHaveAttribute("aria-current", "page");

    const jsonLd = container.querySelector('script[type="application/ld+json"]')?.textContent ?? "";
    expect(JSON.parse(jsonLd)).toMatchObject({ "@type": "Product", name: "Espresso Maker", offers: { price: "89.99", priceCurrency: "USD" } });
  });

  test("more in the same category: other products only, top rated first, as h3 cards", async () => {
    const sunglasses = PRODUCTS[3];
    if (!sunglasses) throw new Error("fixture missing");
    renderWithProviders(await ProductPage({ params: params({ productId: sunglasses.id }) }), { session: null });
    const related = screen.getByRole("region", { name: "More in Accessories" });
    expect(within(related).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Straw Sunhat"]);
    expect(within(related).getByRole("link", { name: "View all Accessories" })).toHaveAttribute("href", "/products?category=Accessories");
    // A product alone in its category has no related section.
    renderWithProviders(await ProductPage({ params: params({ productId: product.id }) }), { session: null });
    expect(screen.queryByRole("region", { name: /More in Kitchen/ })).not.toBeInTheDocument();
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
