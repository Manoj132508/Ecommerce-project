import Link from "next/link";
import { publicEnv } from "@/lib/env/public";
import { Container } from "./Container";

const linkClass = "focus-ring rounded-sm text-white/85 underline-offset-4 hover:text-white hover:underline";

/**
 * Site footer: navigation and only what is true about the store today. No
 * address, policies or reviews are shown until real ones exist.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 bg-brand text-brand-foreground [--ring:#ffffff]">
      <Container className="grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="grid content-start gap-3">
          <p className="text-lg font-semibold">{publicEnv.appName}</p>
          <p className="max-w-md text-sm text-white/85">
            No payment provider is connected. Placing an order records it; no card is charged.
          </p>
        </div>
        <nav aria-label="Shop">
          <h2 className="mb-3 text-sm font-semibold">Shop</h2>
          <ul className="grid gap-2 text-sm">
            <li><Link href="/products" className={linkClass}>All products</Link></li>
            <li><Link href="/cart" className={linkClass}>Cart</Link></li>
            <li><Link href="/checkout" className={linkClass}>Checkout</Link></li>
          </ul>
        </nav>
        <nav aria-label="Your account">
          <h2 className="mb-3 text-sm font-semibold">Your account</h2>
          <ul className="grid gap-2 text-sm">
            <li><Link href="/orders" className={linkClass}>Orders</Link></li>
            <li><Link href="/account" className={linkClass}>Account</Link></li>
          </ul>
        </nav>
      </Container>
      <div className="border-t border-white/15">
        <Container className="py-4 text-sm text-white/85">
          <p>&copy; {new Date().getFullYear()} {publicEnv.appName}</p>
        </Container>
      </div>
    </footer>
  );
}
