import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-slate-600">This page does not exist, or has not moved to the new storefront yet.</p>
      <Link href="/" className="font-medium underline underline-offset-4">Back to the store</Link>
    </div>
  );
}
