import { Skeleton } from "@/components/ui/skeleton";
import { PRODUCT_GRID_CLASS } from "@/features/catalog/ProductCard";

/** Same boxes as the heading, the category/sort toolbar and the product cards, so the page does not jump. */
export default function ProductsLoading() {
  return (
    <div role="status" aria-label="Loading products" className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-11 w-24 rounded-full lg:h-9" />)}
        </div>
        <Skeleton className="h-11 w-56 lg:h-10" />
      </div>
      <div className={PRODUCT_GRID_CLASS}>
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-md border border-border p-3 sm:p-4">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-11 w-full lg:h-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
