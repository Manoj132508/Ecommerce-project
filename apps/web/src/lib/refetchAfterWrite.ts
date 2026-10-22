import type { QueryClient } from "@tanstack/react-query";

/**
 * After a write (cart change, order placed): discard reads that started
 * before it, then fetch again. Invalidating alone is not enough: TanStack
 * Query joins a query's in-flight *first* fetch instead of restarting it, so
 * an answer computed before the write would stick (for example a payment
 * summary that still lists a product the shopper just removed).
 */
export async function refetchAfterWrite(queryClient: QueryClient, roots: readonly (readonly string[])[]) {
  await Promise.all(roots.map((queryKey) => queryClient.cancelQueries({ queryKey })));
  await Promise.all(roots.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
