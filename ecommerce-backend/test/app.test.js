// App-level behaviour outside the 16 API endpoints: health routes, CORS,
// and Express default error responses (which are HTML, not { message }).
import mongoose from "mongoose";
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

  // R36 (Phase 5): previously Express's default HTML 500 page.
  test.each(["https://evil.example", "null", "http://localhost:5173.evil.example", "HTTP://LOCALHOST:5173"])(
    "rejects the origin %s with a JSON 403 and no CORS headers",
    async (origin) => {
      const response = await api().get("/getjson").set("Origin", origin);
      expect(response.status).toBe(403);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.body).toEqual({ message: "Origin not allowed" });
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    },
  );

  test("a rejected cross-origin write reaches no route and writes nothing", async () => {
    const response = await api().post("/api/auth/register").set("Origin", "https://evil.example")
      .send({ name: "Mallory", email: "mallory@example.com", password: "password-123" });
    expect(response.status).toBe(403);
    expect(await mongoose.connection.db.collection("users").countDocuments()).toBe(0);
  });

  test("allowed origins still get CORS preflight answers", async () => {
    const response = await api().options("/api/auth/login").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "POST");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
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
