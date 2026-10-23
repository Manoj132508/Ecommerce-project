import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState headingLevel={1} title="Page not found" action={<Link href="/" className={buttonVariants()}>Back to the store</Link>}>
      <p>This page does not exist, or has not moved to the new storefront yet.</p>
    </EmptyState>
  );
}
