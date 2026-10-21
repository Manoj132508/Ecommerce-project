// App-level behaviour outside the 16 API endpoints: health routes, CORS,
// and Express default error responses (which are HTML, not { message }).
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./helpers.js";

afterEach(() => {
  delete process.env.CLIENT_URL;
});

describe("health routes", () => {
  test("GET / returns plain text", async () => {
    const response = await api().get("/");
    expect(response.status).toBe(200);
    expect(response.text).toBe("Ecommerce API is running");
  });

  test("GET /getjson returns a JSON greeting", async () => {
    const response = await api().get("/getjson");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ msg: "Hello from the ecommerce API" });
  });
});

describe("CORS", () => {
  test.each([
    "http://localhost:5173",
    "http://localhost:5174",
    "https://ecommerce-project-three-peach.vercel.app",
  ])("allows the built-in origin %s", async (origin) => {
    const response = await api().get("/getjson").set("Origin", origin);
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
  });

  test("allows every origin listed in CLIENT_URL (comma-separated, trimmed)", async () => {
    process.env.CLIENT_URL = " https://one.example , https://two.example ";
    for (const origin of ["https://one.example", "https://two.example"]) {
      const response = await api().get("/getjson").set("Origin", origin);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
    }
  });

  test("allows requests without an Origin header", async () => {
    const response = await api().get("/getjson");
    expect(response.status).toBe(200);
  });

  test("rejects other origins with Express's default HTML 500 page", async () => {
    const response = await api().get("/getjson").set("Origin", "https://evil.example");
    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("Express default error responses", () => {
  test("unknown routes are 404 HTML, not the { message } envelope", async () => {
    const response = await api().get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
  });

  test("malformed JSON bodies are 400 HTML", async () => {
    const response = await api()
      .post("/api/cart-items")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(response.status).toBe(400);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
  });
});
