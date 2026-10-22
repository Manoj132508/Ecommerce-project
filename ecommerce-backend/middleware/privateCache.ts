import type { RequestHandler } from "express";

/** Authenticated customer data must never be stored by a browser or shared intermediary. */
export const privateNoStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.vary("Cookie");
  res.vary("Authorization");
  next();
};
