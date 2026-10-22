"use client";

import { useSearchParams } from "next/navigation";
import { safeReturnPath } from "@/lib/returnPath";

/** The validated ?from= destination after signing in (defaults to the home page). */
export function useReturnPath(): string {
  return safeReturnPath(useSearchParams().get("from"));
}
