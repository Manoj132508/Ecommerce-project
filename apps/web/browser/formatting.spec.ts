import { expect, test } from "./support";
import { formatDeliveryDate, formatDeliveryDay, formatOrderTime } from "../src/lib/format";

// Dates are rendered on the server (Node's ICU data) and again in the browser
// during hydration (the engine's ICU data). If the two disagree for the same
// timestamp and zone, React reports a hydration mismatch (error #418). CI
// showed one on Linux WebKit for orders 25–400 days old (Phase 7A); this test
// names the exact strings that differ.
const DAY = 86_400_000;

test("date formats render the same in the browser as on the server", async ({ page }) => {
  await page.goto("/no-such-page");
  const now = Date.now();
  const stamps = [
    now, now - 25 * DAY, now - 30 * DAY, now - 395 * DAY, now - 400 * DAY,
    // Around the UK clock changes (last Sundays of March and October, 01:00 UTC).
    Date.UTC(2026, 2, 29, 0, 59), Date.UTC(2026, 2, 29, 1, 1), Date.UTC(2026, 9, 25, 0, 59), Date.UTC(2026, 9, 25, 1, 1),
  ];
  const browser = await page.evaluate((times) => {
    const zone = "Europe/London";
    const orderTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zone });
    const deliveryDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: zone });
    const deliveryDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: zone });
    return times.map((time) => [orderTime.format(time), deliveryDay.format(time), deliveryDate.format(time)]);
  }, stamps);
  const server = stamps.map((time) => [formatOrderTime(time), formatDeliveryDay(time), formatDeliveryDate(time)]);
  const differences = stamps.flatMap((time, index) => ["orderTime", "deliveryDay", "deliveryDate"].flatMap((name, column) => (
    browser[index]![column] === server[index]![column] ? [] : [`${new Date(time).toISOString()} ${name}: server ${JSON.stringify(server[index]![column])} vs browser ${JSON.stringify(browser[index]![column])}`]
  )));
  expect(differences).toEqual([]);
});
