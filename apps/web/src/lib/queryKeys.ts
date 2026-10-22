// TanStack Query keys. Server data lives only in the query cache, never in Redux.
// Data that belongs to a signed-in user is keyed under USER_SCOPED_ROOTS and
// removed whenever the signed-in identity changes.

export const sessionQueryKey = ["auth", "session"] as const;
export const productsQueryKey = ["products"] as const;

export const USER_SCOPED_ROOTS: readonly string[] = ["cart", "checkout", "orders", "order"];

export const isUserScopedKey = (key: readonly unknown[]) => typeof key[0] === "string" && USER_SCOPED_ROOTS.includes(key[0]);
