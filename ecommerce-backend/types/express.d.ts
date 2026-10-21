import type { UserDocument } from "../models/User.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by the protect middleware (password excluded); absent on public routes. */
      user?: UserDocument;
    }
  }
}

export {};
