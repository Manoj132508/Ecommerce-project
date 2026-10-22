import type { AuthUser } from "../repositories/types.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by the protect middleware (password excluded); absent on public routes. */
      user?: AuthUser;
    }
  }
}

export {};
