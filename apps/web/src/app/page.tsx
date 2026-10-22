import { CatalogPreview } from "@/features/catalog/CatalogPreview";

// Placeholder home page (Phase 5A). The storefront pages move here one by one
// after approval; until then the Vite app remains the live storefront.
export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Store preview</h1>
        <p className="mt-1 text-slate-600">
          The new storefront is being built. Products below are loaded through this site&apos;s own /api.
        </p>
      </div>
      <CatalogPreview />
    </div>
  );
}
