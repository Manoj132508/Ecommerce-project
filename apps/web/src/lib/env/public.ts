// Values safe for the browser. Next.js inlines NEXT_PUBLIC_* at build time,
// so each must be referenced literally here.
import { parseAppName, parseSiteUrl } from "./parse";

export const publicEnv = {
  appName: parseAppName(process.env.NEXT_PUBLIC_APP_NAME),
  /** Public origin (for example https://shop.example.com), set per deployment at build time. */
  siteUrl: parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL),
} as const;
