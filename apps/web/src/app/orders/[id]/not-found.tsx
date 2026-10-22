import Link from "next/link";

export default function OrderNotFound() {
  return (
    <section className="rounded-lg border p-8 text-center">
      <h1 className="mb-2 text-2xl font-bold">Order not found</h1>
      <p className="mb-5 text-slate-600">The order does not exist or does not belong to your account.</p>
      <Link href="/orders" className="font-semibold text-[#08783e] underline">Return to your orders</Link>
    </section>
  );
}
