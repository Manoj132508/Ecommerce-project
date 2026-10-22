"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards. A component in
 * its own Suspense boundary can hydrate after client data (for example the
 * session) has already arrived; rendering the server's output until then
 * keeps the first client render identical to the HTML.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
