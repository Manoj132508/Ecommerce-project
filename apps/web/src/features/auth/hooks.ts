"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isUserScopedKey, sessionQueryKey } from "@/lib/queryKeys";
import { fetchSession, signIn, signOut, type Credentials, type Session } from "./api";

/** Removes every user's cart, checkout and order data from the cache. */
function clearUserScopedQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => isUserScopedKey(query.queryKey) });
}

export function useSession() {
  return useQuery<Session | null>({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
    retry: false,
    staleTime: 60_000,
  });
}

/** The CSRF token for unsafe requests; undefined while signed out. */
export function useCsrfToken(): string | undefined {
  return useSession().data?.csrfToken;
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["auth", "sign-in"],
    mutationFn: (credentials: Credentials) => signIn(credentials),
    onSuccess: (session) => {
      // A new identity: nothing cached for a previous user may be shown.
      clearUserScopedQueries(queryClient);
      queryClient.setQueryData(sessionQueryKey, session);
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["auth", "sign-out"],
    mutationFn: async () => {
      const session = queryClient.getQueryData<Session | null>(sessionQueryKey);
      if (session) await signOut(session.csrfToken);
    },
    // Signed out locally even if the request failed; the server session then
    // expires on its own, and the next sign-in rotates it.
    onSettled: () => {
      clearUserScopedQueries(queryClient);
      queryClient.setQueryData(sessionQueryKey, null);
    },
  });
}
