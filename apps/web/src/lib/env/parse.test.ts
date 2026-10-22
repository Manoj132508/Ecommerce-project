import { describe, expect, test } from "vitest";
import { EnvironmentError, parseAppName, parseBackendOrigin } from "./parse";

describe("BACKEND_ORIGIN", () => {
  test.each([
    ["https://api.example.com", "https://api.example.com"],
    ["https://ecommerce-backend.onrender.com", "https://ecommerce-backend.onrender.com"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["  https://api.example.com  ", "https://api.example.com"],
  ])("accepts %j", (value, origin) => {
    expect(parseBackendOrigin(value).origin).toBe(origin);
  });

  test.each([
    [undefined, /not set/],
    ["", /not set/],
    ["not a url", /not a valid URL/],
    ["ftp://api.example.com", /http or https/],
    ["https://user:pass@api.example.com", /credentials/],
    ["https://api.example.com/", /exact origin/],
    ["https://api.example.com/api", /exact origin/],
    ["https://api.example.com?x=1", /exact origin/],
    ["http://api.example.com", /https unless it is a loopback/],
    ["http://10.0.0.5:3000", /https unless it is a loopback/],
  ])("rejects %j", (value, message) => {
    expect(() => parseBackendOrigin(value)).toThrow(EnvironmentError);
    expect(() => parseBackendOrigin(value)).toThrow(message);
  });
});

test("app name falls back to a default", () => {
  expect(parseAppName(undefined)).toBe("Ecommerce");
  expect(parseAppName("  Shop ")).toBe("Shop");
  expect(parseAppName("x".repeat(61))).toBe("Ecommerce");
});
