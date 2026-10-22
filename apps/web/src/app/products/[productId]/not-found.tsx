import Link from "next/link";

// Rendered with a 404 status for malformed ids and products that do not exist.
export default function ProductNotFound() {
  return (
    <div className="flex flex-col items-center gap-5 p-6 text-center">
      <h1 className="text-2xl font-bold">Product not found</h1>
      <p className="text-[#555]">The product may have been removed or the link is incorrect.</p>
      <Link href="/products" className="rounded-md border border-slate-300 px-5 py-2.5 font-medium hover:bg-slate-100">
        Back to products
      </Link>
    </div>
  );
}
