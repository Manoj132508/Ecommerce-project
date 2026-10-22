"use client";

// Replaces the root layout when the layout itself fails, so it renders its own <html>.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>Something went wrong</h1>
        <p>Please try again.</p>
        <button type="button" onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
