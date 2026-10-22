import { describe, expect, test } from "vitest";
import { EnvironmentError, parseAppName, parseBackendOrigin, parseClientIpForwarding } from "./parse";

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

describe("client-address forwarding", () => {
  test("both settings or neither; a header name and a long secret", () => {
    expect(parseClientIpForwarding(undefined, undefined)).toBeUndefined();
    expect(parseClientIpForwarding(" X-Real-IP ", "s".repeat(32))).toEqual({ header: "x-real-ip", secret: "s".repeat(32) });
    expect(() => parseClientIpForwarding("x-real-ip", undefined)).toThrow(/both/);
    expect(() => parseClientIpForwarding(undefined, "s".repeat(32))).toThrow(/both/);
    expect(() => parseClientIpForwarding("x real ip", "s".repeat(32))).toThrow(/header name/);
    expect(() => parseClientIpForwarding("x-real-ip", "short")).toThrow(/32 characters/);
  });
});

test("app name falls back to a default", () => {
  expect(parseAppName(undefined)).toBe("Ecommerce");
  expect(parseAppName("  Shop ")).toBe("Shop");
  expect(parseAppName("x".repeat(61))).toBe("Ecommerce");
});
