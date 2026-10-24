// App-level behaviour outside the 16 API endpoints: health routes, CORS,
// and the JSON error responses for unknown routes and failed requests.
import express from "express";
import mongoose from "mongoose";
import request from "supertest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { errorHandler } from "../middleware/errorHandlers.js";
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

describe("error responses (Phase 7A: JSON, never a stack trace)", () => {
  // Until Phase 7A these were Express's HTML pages; outside NODE_ENV=production
  // the malformed-JSON page included the stack trace and server file paths.
  const STACK = /\bat \S+ \(|node_modules|[\\/]ecommerce-backend[\\/]|SyntaxError|<pre>|<html/i;
  const environments = ["production", "development", undefined];
  let saved;
  const inEnvironment = (value) => {
    saved = process.env.NODE_ENV;
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
  };
  afterEach(() => {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  });

  test.each(environments)("NODE_ENV=%s: unknown routes are a JSON 404", async (environment) => {
    inEnvironment(environment);
    const response = await api().get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({ message: "Not found" });
  });

  test.each(environments)("NODE_ENV=%s: a malformed JSON body is a JSON 400 without a stack trace", async (environment) => {
    inEnvironment(environment);
    const response = await api().post("/api/cart-items").set("Content-Type", "application/json").send("{not json");
    expect(response.status).toBe(400);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({ message: "Malformed JSON body" });
    expect(response.text).not.toMatch(STACK);
  });

  test("an oversized body is a JSON 413; an unsupported encoding a JSON 415", async () => {
    const large = await api().post("/api/cart-items").set("Content-Type", "application/json").send(JSON.stringify({ note: "x".repeat(150_000) }));
    expect(large.status).toBe(413);
    expect(large.body).toEqual({ message: "Request body too large" });
    const encoded = await api().post("/api/cart-items").set("Content-Type", "application/json").set("Content-Encoding", "br").send("{}");
    expect(encoded.status).toBe(415);
    expect(encoded.body).toEqual({ message: "Unsupported content encoding" });
  });

  test("no X-Powered-By header", async () => {
    const response = await api().get("/getjson");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("errorHandler (unexpected errors)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const boom = (environment) => express()
    .get("/boom", () => { throw new Error("password=hunter2 at /srv/app/secret.js"); })
    .use(errorHandler(environment));

  test.each(["production", "development"])("NODE_ENV=%s: the client gets only \"Server error\"", async (environment) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(boom(environment)).get("/boom");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Server error" });
    expect(response.text).not.toMatch(/hunter2|secret\.js|\bat /);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  test("the server log keeps the stack in development and only the message in production", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await request(boom("development")).get("/boom");
    expect(String(errors.mock.calls[0]?.[1])).toMatch(/^Error: .*\n\s+at /);
    errors.mockClear();
    await request(boom("production")).get("/boom");
    expect(errors.mock.calls[0]?.[1]).toBe("password=hunter2 at /srv/app/secret.js");
    expect(String(errors.mock.calls[0]?.[1])).not.toMatch(/\n\s+at /);
  });
});
