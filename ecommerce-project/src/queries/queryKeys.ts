// TanStack Query keys. User-specific server data (cart, checkout, orders) is
// keyed by the user's id, so cached data can never be shown to another user,
// even before logout clears it. "anonymous" is the legacy shared MongoDB cart.

export const ANONYMOUS = 'anonymous';

export type UserScope = string | null;

const scope = (userId: UserScope) => userId ?? ANONYMOUS;

export const authQueryKey = ['auth', 'profile'] as const;
export const productsQueryKey = ['products'] as const;

/** Key roots for user-specific data: invalidating or removing a root covers every user. */
export const USER_SCOPED_ROOTS = ['cart', 'checkout', 'orders'] as const;
export const cartRootKey = ['cart'] as const;
export const checkoutRootKey = ['checkout'] as const;
export const ordersRootKey = ['orders'] as const;

export const cartQueryKey = (userId: UserScope) => ['cart', scope(userId)] as const;
export const checkoutQueryKey = (userId: UserScope) => ['checkout', scope(userId)] as const;
export const ordersQueryKey = (userId: UserScope) => ['orders', scope(userId)] as const;
export const orderQueryKey = (userId: UserScope, orderId: string) => ['orders', scope(userId), orderId] as const;

export const isUserScopedKey = (queryKey: readonly unknown[]) => (
  USER_SCOPED_ROOTS.some((root) => root === queryKey[0])
);

/** Mutations that authenticate; their 401 means "wrong credentials", not an expired session. */
export const loginMutationKey = ['auth', 'login'] as const;
export const registerMutationKey = ['auth', 'register'] as const;

export const isAuthMutationKey = (mutationKey: readonly unknown[] | undefined) => mutationKey?.[0] === 'auth';
