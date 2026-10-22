// Dates are formatted in one fixed store time zone. Order pages render on the
// server and hydrate in the browser; with each runtime's own zone the text
// could differ (a hydration mismatch) and server-only pages would show the
// host's zone. The Vite app used each browser's zone (intentional change).
export const STORE_TIME_ZONE = "Europe/London";

const orderTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: STORE_TIME_ZONE });
const deliveryDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: STORE_TIME_ZONE });
const deliveryDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: STORE_TIME_ZONE });

/** "22 Oct 2026, 17:05" */
export const formatOrderTime = (milliseconds: number) => orderTime.format(milliseconds);
/** "Thursday 29 October" */
export const formatDeliveryDay = (milliseconds: number) => deliveryDay.format(milliseconds);
/** "Thursday 29 October 2026" */
export const formatDeliveryDate = (milliseconds: number) => deliveryDate.format(milliseconds);
