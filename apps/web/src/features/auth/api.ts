// Cookie-session API (Express /api/auth/session). The session token is only
// ever in the HttpOnly cookie; responses carry the user and the CSRF token.
import { ApiError, apiFetch } from "@/lib/api/client";

export interface SessionUser {
  _id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface Session {
  user: SessionUser;
  csrfToken: string;
}

export interface Credentials {
  email: string;
  password: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function parseSession(data: unknown): Session {
  if (isRecord(data) && typeof data.csrfToken === "string" && isRecord(data.user)) {
    const { _id, name, email, isAdmin } = data.user;
    if (typeof _id === "string" && typeof name === "string" && typeof email === "string" && typeof isAdmin === "boolean") {
      return { user: { _id, name, email, isAdmin }, csrfToken: data.csrfToken };
    }
  }
  throw new ApiError(502, "Unexpected response from the API.");
}

/** The current session, or null when signed out. */
export async function fetchSession(): Promise<Session | null> {
  try {
    return parseSession(await apiFetch("/auth/session"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function signIn(credentials: Credentials): Promise<Session> {
  return parseSession(await apiFetch("/auth/session", { method: "POST", body: credentials, signIn: true }));
}

export async function signOut(csrfToken: string): Promise<void> {
  await apiFetch("/auth/session", { method: "DELETE", csrfToken });
}
