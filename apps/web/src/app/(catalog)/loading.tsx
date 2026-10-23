import { Skeleton } from "@/components/ui/skeleton";
import { PRODUCT_ROW_CLASS } from "@/features/catalog/ProductCard";

/** The home page's boxes (hero, categories, top-rated row), so nothing jumps when it arrives. */
export default function HomeLoading() {
  return (
    <div role="status" aria-label="Loading the store" className="flex flex-col gap-12 sm:gap-16">
      <Skeleton className="h-[26rem] w-full rounded-lg lg:h-80" />
      <div className="flex flex-col gap-5">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="aspect-[4/5] w-full" />)}
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-8 w-40" />
        <div className={PRODUCT_ROW_CLASS}>
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="aspect-[3/5] w-full" />)}
        </div>
      </div>
    </div>
  );
}
