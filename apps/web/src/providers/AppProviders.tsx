"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { makeStore } from "@/store/store";
import { ApiError } from "@/lib/api/client";
import { sessionQueryKey } from "@/lib/queryKeys";
import { announceSessionExpired } from "@/features/auth/sessionExpiry";
import { SessionExpiryWatcher } from "@/features/auth/SessionExpiryWatcher";

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

const makeQueryClient = () => new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const isSessionQuery = query.queryKey.length === sessionQueryKey.length
        && query.queryKey.every((value, index) => value === sessionQueryKey[index]);
      if (isUnauthorized(error) && !isSessionQuery) announceSessionExpired();
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (isUnauthorized(error) && mutation.options.mutationKey?.[0] !== "auth") announceSessionExpired();
    },
  }),
  defaultOptions: {
    queries: {
      retry: (attempt, error) => !isUnauthorized(error) && attempt < 1,
      staleTime: 30_000,
    },
  },
});

/**
 * Client boundary for Redux (UI state) and TanStack Query (server state).
 * Both are created once per mounted tree, never shared between server requests.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [store] = useState(makeStore);

  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <SessionExpiryWatcher />
        {children}
      </QueryClientProvider>
    </ReduxProvider>
  );
}
