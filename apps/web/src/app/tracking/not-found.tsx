import Link from "next/link";

export default function TrackingNotFound() {
  return (
    <section className="rounded-lg border p-8 text-center">
      <h1 className="mb-2 text-2xl font-bold">Package details could not be found</h1>
      <p className="mb-5 text-slate-600">The order or product does not exist, or does not belong to your account.</p>
      <Link href="/orders" className="font-semibold text-[#08783e] underline">View all orders</Link>
    </section>
  );
}
