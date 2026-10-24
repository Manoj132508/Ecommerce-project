import { expect, test } from "./support";
import { formatDeliveryDate, formatDeliveryDay, formatOrderTime } from "../src/lib/format";

// Dates are rendered on the server and again in the browser during hydration.
// Linux WebKit's ICU writes "Saturday 24 October 2026" where Node writes
// "Saturday, 24 October 2026" (CI run 40084134454), which caused React
// hydration error #418 on order pages. lib/format.ts therefore takes only the
// numeric store-zone date parts from Intl and builds the text itself. This test
// checks the assumption that fix rests on — the numeric parts agree in every
// engine — and records any engine whose locale patterns differ from Node's.
const DAY = 86_400_000;

test("store-zone date parts agree between the browser and the server", async ({ page }, testInfo) => {
  await page.goto("/no-such-page");
  const now = Date.now();
  const stamps = [
    now, now - 25 * DAY, now - 30 * DAY, now - 395 * DAY, now - 400 * DAY,
    // Around the UK clock changes (last Sundays of March and October, 01:00 UTC) and midnight.
    Date.UTC(2026, 2, 29, 0, 59), Date.UTC(2026, 2, 29, 1, 1), Date.UTC(2026, 9, 25, 0, 59), Date.UTC(2026, 9, 25, 1, 1), Date.UTC(2026, 5, 30, 23, 30),
  ];
  const partsIn = (times: number[]) => {
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
    });
    return times.map((time) => clock.formatToParts(time).filter((part) => part.type !== "literal").map((part) => `${part.type}=${part.value}`).join(" "));
  };
  const browser = await page.evaluate(partsIn, stamps);
  expect(browser).toEqual(partsIn(stamps));

  // Information only: where the engine's own locale pattern differs from the server's text.
  const styled = await page.evaluate((times) => {
    const date = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
    return times.map((time) => date.format(time));
  }, stamps);
  const differing = stamps.filter((time, index) => styled[index] !== formatDeliveryDate(time)).map((time) => `${formatDeliveryDate(time)} vs engine ${styled[stamps.indexOf(time)]}`);
  testInfo.annotations.push({ type: "locale pattern differences", description: differing.length ? differing.slice(0, 3).join("; ") : "none" });
  // The app's own text is the same everywhere (it is built from the numeric parts).
  expect(formatOrderTime(stamps[0]!)).toMatch(/^\d{1,2} [A-Z][a-z]{2,3} \d{4}, \d{2}:\d{2}$/);
  expect(formatDeliveryDay(stamps[0]!)).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/);
});
