import { ApiError, apiFetch } from "@/lib/api/client";

/** The fields the placeholder home page shows; the full product type comes with page migration. */
export interface ProductSummary {
  id: string;
  name: string;
  priceCents: number;
}

export async function fetchProductSummaries(): Promise<ProductSummary[]> {
  const data = await apiFetch("/products");
  if (!Array.isArray(data)) throw new ApiError(502, "Unexpected response from the API.");
  return data.flatMap((item: unknown) => (
    typeof item === "object" && item !== null && "id" in item && "name" in item && "priceCents" in item
      && typeof item.id === "string" && typeof item.name === "string" && typeof item.priceCents === "number"
      ? [{ id: item.id, name: item.name, priceCents: item.priceCents }]
      : []
  ));
}
