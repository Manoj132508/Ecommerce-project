// Values safe for the browser. Next.js inlines NEXT_PUBLIC_* at build time,
// so each must be referenced literally here.
import { parseAppName } from "./parse";

export const publicEnv = {
  appName: parseAppName(process.env.NEXT_PUBLIC_APP_NAME),
} as const;
