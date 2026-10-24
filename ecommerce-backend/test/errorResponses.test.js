// Error responses never carry internal details (Phase 7A security review).
// Repositories are stubbed to fail the way a lost database connection does.
import request from "supertest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../app.js";
import { createRepositories } from "../repositories/index.js";

const DETAIL = "connect ECONNREFUSED 10.20.30.40:5432";
const failingList = () => Promise.reject(Object.assign(new Error(DETAIL), { code: "ECONNREFUSED" }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("read endpoints when the database is unreachable", () => {
  test.each([
    ["/api/products", "products", "Unable to load products"],
    ["/api/delivery-options", "deliveryOptions", "Unable to load delivery options"],
  ])("GET %s: a fixed JSON message; the detail only in the server log", async (path, repository, message) => {
    const repositories = createRepositories();
    vi.spyOn(repositories[repository], "list").mockImplementation(failingList);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(createApp({ repositories })).get(path);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message });
    expect(response.text).not.toContain("ECONNREFUSED");
    expect(response.text).not.toContain("10.20.30.40");
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/failed:$/), DETAIL);
  });
});
