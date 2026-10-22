"use client";

import { useEffect } from "react";

// The catalogue could not be loaded (API unreachable or failing). No details are shown.
export default function ProductsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Catalogue error", error.digest ?? "");
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Unable to load products</h1>
      <p className="text-slate-600">Please try again in a moment.</p>
      <button type="button" onClick={reset} className="rounded-md bg-slate-900 px-4 py-2 text-white">
        Try again
      </button>
    </div>
  );
}
