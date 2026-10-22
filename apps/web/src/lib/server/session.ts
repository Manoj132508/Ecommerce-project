// The signed-in user for Server Components (account pages). Forwards only the
// session cookie to Express; the cookie value is never exposed to the page.
import "server-only";
import { cookies } from "next/headers";
import { parseSession, type SessionUser } from "@/features/auth/api";
import { serverEnv } from "@/lib/env/server";
import { SESSION_COOKIE_NAMES } from "@/lib/proxy/backendProxy";

export async function getServerSessionCookieHeader(): Promise<string | null> {
  const jar = await cookies();
  const cookie = [...SESSION_COOKIE_NAMES].map((name) => jar.get(name)).find((entry) => entry !== undefined);
  return cookie ? `${cookie.name}=${cookie.value}` : null;
}

export async function getServerSessionUser(): Promise<SessionUser | null> {
  const cookie = await getServerSessionCookieHeader();
  if (!cookie) return null;

  const response = await fetch(new URL("/api/auth/session", serverEnv().backendOrigin), {
    headers: { Accept: "application/json", Cookie: cookie },
    cache: "no-store",
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("The session could not be checked.");
  // Only the user leaves this function; the CSRF token stays with the client session query.
  return parseSession(await response.json()).user;
}
