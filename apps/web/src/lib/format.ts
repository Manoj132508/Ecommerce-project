// Dates are formatted in one fixed store time zone. Order pages render on the
// server and hydrate in the browser; with each runtime's own zone the text
// could differ (a hydration mismatch) and server-only pages would show the
// host's zone. The Vite app used each browser's zone (intentional change).
//
// The text is also built here rather than by Intl's locale patterns: Node and
// the browser carry different ICU data, and they do not always agree on
// punctuation (Linux WebKit writes "Saturday 24 October 2026" where Node writes
// "Saturday, 24 October 2026": React hydration error #418, Phase 7A). Only the
// numeric date parts come from Intl — ASCII digits in every engine — and the
// names and separators are fixed, matching Node's en-GB output.
export const STORE_TIME_ZONE = "Europe/London";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const storeClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: STORE_TIME_ZONE, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
});

interface StoreDate { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

/** The calendar date and time in the store's zone, as numbers. */
function storeDate(milliseconds: number): StoreDate {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of storeClock.formatToParts(milliseconds)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0 } = parts;
  // The weekday of that calendar date (computed in UTC, so no zone is involved).
  return { year, month, day, hour, minute, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** "22 Oct 2026, 17:05" */
export function formatOrderTime(milliseconds: number): string {
  const date = storeDate(milliseconds);
  return `${date.day} ${SHORT_MONTHS[date.month - 1]} ${date.year}, ${twoDigits(date.hour)}:${twoDigits(date.minute)}`;
}

/** "Thursday 29 October" */
export function formatDeliveryDay(milliseconds: number): string {
  const date = storeDate(milliseconds);
  return `${WEEKDAYS[date.weekday]} ${date.day} ${MONTHS[date.month - 1]}`;
}

/** "Thursday, 29 October 2026" */
export function formatDeliveryDate(milliseconds: number): string {
  const date = storeDate(milliseconds);
  return `${WEEKDAYS[date.weekday]}, ${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}
