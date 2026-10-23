"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";

// Route-level error boundary. Shows no error details to the visitor.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Page error", error.digest ?? "");
  }, [error]);

  return (
    <EmptyState role="alert" headingLevel={1} title="Something went wrong" action={<Button onClick={reset}>Try again</Button>}>
      <p>Please try again.</p>
    </EmptyState>
  );
}
