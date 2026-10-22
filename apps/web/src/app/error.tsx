"use client";

import { useEffect } from "react";

// Route-level error boundary. Shows no error details to the visitor.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Page error", error.digest ?? "");
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-slate-600">Please try again.</p>
      <button type="button" onClick={reset} className="rounded-md bg-slate-900 px-4 py-2 text-white">
        Try again
      </button>
    </div>
  );
}
