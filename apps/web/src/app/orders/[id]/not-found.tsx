import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { buttonVariants } from "@/components/ui/button";

// 404 for a malformed id, an unknown order or another customer's order (the same answer for each).
export default function OrderNotFound() {
  return (
    <EmptyState headingLevel={1} title="Order not found" action={<Link href="/orders" className={buttonVariants()}>Return to your orders</Link>}>
      <p>The order does not exist or does not belong to your account.</p>
    </EmptyState>
  );
}
