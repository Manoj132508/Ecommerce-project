import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { buttonVariants } from "@/components/ui/button";

// 404 for bad ids, an unknown or foreign order, or a product that is not in it.
export default function TrackingNotFound() {
  return (
    <EmptyState headingLevel={1} title="Package details could not be found" action={<Link href="/orders" className={buttonVariants()}>View all orders</Link>}>
      <p>The order or product does not exist, or does not belong to your account.</p>
    </EmptyState>
  );
}
