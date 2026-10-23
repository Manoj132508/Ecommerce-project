"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";

// The catalogue could not be loaded (API unreachable or failing). No details are shown.
export default function ProductsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Catalogue error", error.digest ?? "");
  }, [error]);

  return (
    <EmptyState role="alert" headingLevel={1} title="Unable to load products" action={<Button onClick={reset}>Try again</Button>}>
      <p>Please try again in a moment.</p>
    </EmptyState>
  );
}
