import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { buttonVariants } from "@/components/ui/button";

// Rendered with a 404 status for malformed ids and products that do not exist
// (including products an administrator has deleted).
export default function ProductNotFound() {
  return (
    <EmptyState
      headingLevel={1}
      title="Product not found"
      action={(
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/products" className={buttonVariants()}>Back to products</Link>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>Go to the home page</Link>
        </div>
      )}
    >
      <p>The product may have been removed or the link is incorrect.</p>
    </EmptyState>
  );
}
