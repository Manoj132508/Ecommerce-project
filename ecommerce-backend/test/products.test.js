// Regression baseline for P1–P4 (MIGRATION_PLAN.md §2). These pin the
// current MongoDB-backed behaviour that the PostgreSQL version must match.
import { beforeEach, describe, expect, test } from "vitest";
import Product from "../models/Product.js";
import {
  api,
  bearer,
  createAdmin,
  createUser,
  ISO_DATE,
  PRODUCTS,
  seedCatalog,
  UUID,
} from "./helpers.js";

const PRODUCT_KEYS = [
  "careInstructions", "category", "createdAt", "description", "highlights", "howItWorks",
  "id", "image", "keywords", "name", "priceCents", "rating", "stock", "updatedAt",
];

const validForm = {
  name: "  Stainless Kettle  ",
  price: "19.99",
  description: "  Boils water.  ",
  howItWorks: "  Fill and switch on.  ",
  highlights: " 1.7 litres ,  Auto shut-off , ",
  careInstructions: "  Descale monthly.  ",
  image: "  images/products/kettle.jpg  ",
  category: "  Kitchen  ",
  stock: "12",
};

describe("GET /api/products", () => {
  test("returns an empty list when there are no products", async () => {
    const response = await api().get("/api/products");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  test("is public and returns every product sorted by createdAt ascending", async () => {
    await seedCatalog();
    const response = await api().get("/api/products");
    expect(response.status).toBe(200);
    expect(response.body.map((product) => product.id)).toEqual([
      PRODUCTS.socks._id,
      PRODUCTS.basketball._id,
      PRODUCTS.tshirt._id,
    ]);
  });

  test("serialises the exact product shape: id instead of _id, nested rating, ISO timestamps", async () => {
    await seedCatalog();
    const [socks] = (await api().get("/api/products")).body;
    expect(Object.keys(socks).sort()).toEqual(PRODUCT_KEYS);
    const { _id, ...stored } = PRODUCTS.socks;
    expect(socks).toMatchObject({ ...stored, id: _id });
    expect(socks.createdAt).toMatch(ISO_DATE);
    expect(socks.updatedAt).toMatch(ISO_DATE);
  });

  test("reports stock as 0 when the stored document has no stock field (all live products)", async () => {
    await seedCatalog();
    expect(await Product.collection.countDocuments({ stock: { $exists: true } })).toBe(0);
    const products = (await api().get("/api/products")).body;
    expect(products.map((product) => product.stock)).toEqual([0, 0, 0]);
  });

  test("product details come from this list: there is no single-product endpoint", async () => {
    // OneProductPage finds the product in the GET /api/products result.
    await seedCatalog();
    const response = await api().get(`/api/products/${PRODUCTS.socks._id}`);
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/text\/html/);

    const [socks] = (await api().get("/api/products")).body;
    expect(socks).toMatchObject({
      description: PRODUCTS.socks.description,
      howItWorks: PRODUCTS.socks.howItWorks,
      highlights: PRODUCTS.socks.highlights,
      careInstructions: PRODUCTS.socks.careInstructions,
      rating: PRODUCTS.socks.rating,
    });
  });
});

describe("POST /api/products", () => {
  test("requires a bearer token", async () => {
    const response = await api().post("/api/products").send(validForm);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Not authorized" });
    expect(await Product.countDocuments()).toBe(0);
  });

  test("requires an admin user, even for an invalid body", async () => {
    const { token } = await createUser();
    for (const body of [validForm, {}]) {
      const response = await api().post("/api/products").set(bearer(token)).send(body);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ message: "Admin access required" });
    }
    expect(await Product.countDocuments()).toBe(0);
  });

  test("rejects incomplete or invalid product details", async () => {
    const { token } = await createAdmin();
    const invalidBodies = [
      {},
      { ...validForm, name: "   " },
      { ...validForm, description: undefined },
      { ...validForm, howItWorks: "" },
      { ...validForm, careInstructions: 5 },
      { ...validForm, highlights: [] },
      { ...validForm, highlights: " , , " },
      { ...validForm, highlights: [1, 2] },
      { ...validForm, image: { $ne: null } },
      { ...validForm, category: "" },
      { ...validForm, price: "-1" },
      { ...validForm, price: "abc" },
      { ...validForm, stock: "1.5" },
      { ...validForm, stock: "-1" },
    ];
    for (const body of invalidBodies) {
      const response = await api().post("/api/products").set(bearer(token)).send(body);
      expect(response.status, `Expected rejection for ${JSON.stringify(body)}`).toBe(400);
      expect(response.body).toEqual({ message: "Please provide valid product details" });
    }
    expect(await Product.countDocuments()).toBe(0);
  });

  test("creates a product from form data: trims text, converts dollars to cents, derives keywords", async () => {
    const { token } = await createAdmin();
    const response = await api().post("/api/products").set(bearer(token)).send({
      ...validForm,
      // Client-supplied server-owned fields are ignored.
      id: "attacker-chosen-id",
      rating: { stars: 5, count: 9999 },
      keywords: ["spam"],
    });

    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(PRODUCT_KEYS);
    expect(response.body).toMatchObject({
      name: "Stainless Kettle",
      priceCents: 1999,
      description: "Boils water.",
      howItWorks: "Fill and switch on.",
      highlights: ["1.7 litres", "Auto shut-off"],
      careInstructions: "Descale monthly.",
      image: "images/products/kettle.jpg",
      category: "Kitchen",
      stock: 12,
      rating: { stars: 0, count: 0 },
      keywords: ["kitchen"],
    });
    expect(response.body.id).toMatch(UUID);

    const listed = (await api().get("/api/products")).body;
    expect(listed).toEqual([response.body]);
  });

  test("accepts highlights as an array and numeric price/stock", async () => {
    const { token } = await createAdmin();
    const response = await api().post("/api/products").set(bearer(token)).send({
      ...validForm,
      highlights: ["  One ", "", "Two"],
      price: 0,
      stock: 0,
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ highlights: ["One", "Two"], priceCents: 0, stock: 0 });
  });

  test("rounds cents with JavaScript floating point (1.005 → 100, 12.345 → 1235)", async () => {
    // 1.005 * 100 === 100.49999999999999. Documented so the PostgreSQL version
    // keeps the dollars-to-cents conversion in application code.
    const { token } = await createAdmin();
    for (const [price, priceCents] of [["1.005", 100], ["12.345", 1235]]) {
      const response = await api().post("/api/products").set(bearer(token))
        .send({ ...validForm, price });
      expect(response.status).toBe(201);
      expect(response.body.priceCents).toBe(priceCents);
    }
  });
});

describe("PUT /api/products/:productId", () => {
  beforeEach(seedCatalog);

  test("requires a bearer token and an admin user", async () => {
    const path = `/api/products/${PRODUCTS.socks._id}`;
    expect((await api().put(path).send(validForm)).status).toBe(401);
    const { token } = await createUser();
    const response = await api().put(path).set(bearer(token)).send(validForm);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Admin access required" });
  });

  test("validates the body before looking up the product", async () => {
    const { token } = await createAdmin();
    const response = await api().put("/api/products/does-not-exist").set(bearer(token)).send({});
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Please provide valid product details" });
  });

  test("returns 404 for an unknown product", async () => {
    const { token } = await createAdmin();
    const response = await api().put("/api/products/does-not-exist").set(bearer(token)).send(validForm);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Product not found" });
  });

  test("replaces editable fields, keeps id/rating/createdAt, and regenerates keywords", async () => {
    const { token } = await createAdmin();
    const before = (await api().get("/api/products")).body[0];
    const response = await api().put(`/api/products/${PRODUCTS.socks._id}`).set(bearer(token)).send(validForm);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(PRODUCT_KEYS);
    expect(response.body).toMatchObject({
      id: PRODUCTS.socks._id,
      name: "Stainless Kettle",
      priceCents: 1999,
      stock: 12,
      rating: PRODUCTS.socks.rating,
      createdAt: before.createdAt,
      // Original keywords ["socks","sports","apparel"] are replaced.
      keywords: ["kitchen"],
    });
    expect(response.body.updatedAt > before.updatedAt).toBe(true);
    expect((await api().get("/api/products")).body[0]).toEqual(response.body);
  });
});

describe("DELETE /api/products/:productId", () => {
  beforeEach(seedCatalog);

  test("requires a bearer token and an admin user", async () => {
    const path = `/api/products/${PRODUCTS.socks._id}`;
    expect((await api().delete(path)).status).toBe(401);
    const { token } = await createUser();
    expect((await api().delete(path).set(bearer(token))).status).toBe(403);
    expect(await Product.countDocuments()).toBe(3);
  });

  test("deletes the product and returns only its id; a second delete is 404", async () => {
    const { token } = await createAdmin();
    const path = `/api/products/${PRODUCTS.socks._id}`;

    const response = await api().delete(path).set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: PRODUCTS.socks._id });
    expect((await api().get("/api/products")).body.map((product) => product.id))
      .not.toContain(PRODUCTS.socks._id);

    const again = await api().delete(path).set(bearer(token));
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ message: "Product not found" });
  });
});
