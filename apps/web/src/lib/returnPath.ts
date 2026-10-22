// Same rules as the Vite app (ecommerce-project/src/utils/returnPath.ts):
// only in-app paths, never another origin, never back to the sign-in pages.
const AUTH_PAGES = ["/login", "/register"];

export function safeReturnPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  const pathname = value.split(/[?#]/, 1)[0] ?? "";
  if (AUTH_PAGES.includes(pathname)) return fallback;
  return value;
}
