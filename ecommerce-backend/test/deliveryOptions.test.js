// Regression baseline for D1 (MIGRATION_PLAN.md §2).
import { describe, expect, test } from "vitest";
import { api, DAY_MS, DELIVERY_OPTIONS, ISO_DATE, seedCatalog } from "./helpers.js";

describe("GET /api/delivery-options", () => {
  test("returns an empty list when none exist", async () => {
    const response = await api().get("/api/delivery-options");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  test("is public and returns options sorted by createdAt with string ids", async () => {
    await seedCatalog();
    const response = await api().get("/api/delivery-options");
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(3);
    response.body.forEach((option, index) => {
      expect(Object.keys(option).sort()).toEqual(["createdAt", "deliveryDays", "id", "priceCents", "updatedAt"]);
      expect(option).toMatchObject({
        id: DELIVERY_OPTIONS[index]._id,
        deliveryDays: DELIVERY_OPTIONS[index].deliveryDays,
        priceCents: DELIVERY_OPTIONS[index].priceCents,
      });
      expect(option.createdAt).toMatch(ISO_DATE);
    });
  });

  test("?expand=estimatedDeliveryTime adds now + deliveryDays as epoch milliseconds", async () => {
    await seedCatalog();
    const before = Date.now();
    const response = await api().get("/api/delivery-options?expand=estimatedDeliveryTime");
    const after = Date.now();

    expect(response.status).toBe(200);
    response.body.forEach((option) => {
      expect(Object.keys(option).sort()).toEqual([
        "createdAt", "deliveryDays", "estimatedDeliveryTimeMs", "id", "priceCents", "updatedAt",
      ]);
      expect(option.estimatedDeliveryTimeMs).toBeGreaterThanOrEqual(before + option.deliveryDays * DAY_MS);
      expect(option.estimatedDeliveryTimeMs).toBeLessThanOrEqual(after + option.deliveryDays * DAY_MS);
    });
  });

  test("ignores unknown expand values", async () => {
    await seedCatalog();
    const response = await api().get("/api/delivery-options?expand=somethingElse");
    expect(response.body.every((option) => !("estimatedDeliveryTimeMs" in option))).toBe(true);
  });
});
