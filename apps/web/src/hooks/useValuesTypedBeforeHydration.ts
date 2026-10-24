"use client";

import { useEffect, useRef } from "react";

/**
 * A visitor can type into a server-rendered form before React hydrates it. The
 * browser keeps that text on screen, but controlled inputs start from empty
 * state, so submitting reported the fields as empty ("Enter your email
 * address." next to a filled-in email; seen in WebKit on the sign-in page,
 * Phase 7A). Once, when the form mounts, this copies whatever the browser
 * already holds in the given inputs (by id) into state. Afterwards state is
 * the source of truth, as before.
 */
export function useValuesTypedBeforeHydration(fields: Record<string, (value: string) => void>) {
  const adopt = useRef(fields);
  useEffect(() => {
    for (const [id, set] of Object.entries(adopt.current)) {
      const element = document.getElementById(id);
      if (element instanceof HTMLInputElement && element.value) set(element.value);
    }
  }, []);
}
