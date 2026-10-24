import { describe, expect, test } from "vitest";
import { formatDeliveryDate, formatDeliveryDay, formatOrderTime, STORE_TIME_ZONE } from "./format";

// The formatters build their text from numeric date parts (format.ts). These
// tests pin that the result is exactly what Node's en-GB Intl patterns produce,
// so the Phase 7A fix changed no visible text, and cover the cases most likely
// to go wrong: the UK clock changes, midnight, and every month.
const intl = {
  orderTime: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: STORE_TIME_ZONE }),
  deliveryDay: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: STORE_TIME_ZONE }),
  deliveryDate: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: STORE_TIME_ZONE }),
};

describe("store date formats", () => {
  test("match Node's en-GB output every 7 hours over about two and a half years", () => {
    const differences: string[] = [];
    for (let time = Date.UTC(2025, 0, 1); time < Date.UTC(2027, 6, 1); time += 7 * 3_600_000) {
      for (const [name, ours, theirs] of [
        ["orderTime", formatOrderTime(time), intl.orderTime.format(time)],
        ["deliveryDay", formatDeliveryDay(time), intl.deliveryDay.format(time)],
        ["deliveryDate", formatDeliveryDate(time), intl.deliveryDate.format(time)],
      ] as const) {
        if (ours !== theirs) differences.push(`${new Date(time).toISOString()} ${name}: ${ours} vs ${theirs}`);
      }
    }
    expect(differences).toEqual([]);
  });

  test("UK clock changes and midnight use the store's local time", () => {
    // 29 March 2026 01:00 UTC: GMT → BST. 25 October 2026 01:00 UTC: BST → GMT.
    expect(formatOrderTime(Date.UTC(2026, 2, 29, 0, 59))).toBe("29 Mar 2026, 00:59");
    expect(formatOrderTime(Date.UTC(2026, 2, 29, 1, 0))).toBe("29 Mar 2026, 02:00");
    expect(formatOrderTime(Date.UTC(2026, 9, 25, 0, 59))).toBe("25 Oct 2026, 01:59");
    expect(formatOrderTime(Date.UTC(2026, 9, 25, 1, 0))).toBe("25 Oct 2026, 01:00");
    // 23:30 UTC on 30 June is already 1 July in London (BST).
    expect(formatDeliveryDate(Date.UTC(2026, 5, 30, 23, 30))).toBe("Wednesday, 1 July 2026");
    expect(formatDeliveryDay(Date.UTC(2026, 5, 30, 23, 30))).toBe("Wednesday 1 July");
  });

  test("the comma after the weekday stays (Linux WebKit's ICU omits it; Node's includes it)", () => {
    expect(formatDeliveryDate(Date.UTC(2026, 9, 24, 10, 0))).toBe("Saturday, 24 October 2026");
    expect(formatOrderTime(Date.UTC(2026, 8, 8, 9, 5))).toBe("8 Sept 2026, 10:05");
  });
});
