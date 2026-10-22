"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { makeStore } from "@/store/store";

const makeQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Avoid an immediate refetch after hydration.
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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ReduxProvider>
  );
}
