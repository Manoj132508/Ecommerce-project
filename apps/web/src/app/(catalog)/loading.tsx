import { Skeleton } from "@/components/ui/skeleton";
import { PRODUCT_GRID_CLASS } from "@/features/catalog/ProductCard";

/** Same boxes as the product cards, so the page does not jump when they arrive. */
export default function CatalogLoading() {
  return (
    <div role="status" aria-label="Loading products" className="flex flex-col gap-6">
      <Skeleton className="h-9 w-48" />
      <div className={PRODUCT_GRID_CLASS}>
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-md border border-border p-3 sm:p-4">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="h-4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-11 w-full lg:h-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
