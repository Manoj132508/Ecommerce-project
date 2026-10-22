import type { AuthUser } from "../repositories/types.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by the protect middleware (password excluded); absent on public routes. */
      user?: AuthUser;
      /** Set by the session guard for cookie-session requests (never holds the raw token). */
      authSession?: { id: string; csrfToken: string; expiresAt: Date };
    }
  }
}

export {};
