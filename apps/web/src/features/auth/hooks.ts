"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isUserScopedKey, sessionQueryKey } from "@/lib/queryKeys";
import {
  createAccount,
  fetchSession,
  signIn,
  signOut,
  signOutEverywhere,
  type AccountDetails,
  type Credentials,
  type Session,
} from "./api";

/** Removes every user's cart, checkout and order data from the cache. */
export function clearUserScopedQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => isUserScopedKey(query.queryKey) });
}

/** Signed out locally: no user, no CSRF token, no user data left in the cache. */
export function endLocalSession(queryClient: QueryClient) {
  clearUserScopedQueries(queryClient);
  queryClient.setQueryData(sessionQueryKey, null);
}

export function useSession() {
  return useQuery<Session | null>({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
    retry: false,
    staleTime: 60_000,
    // An expired or revoked session is noticed when the tab regains focus.
    refetchOnWindowFocus: true,
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

/** Account creation only; it signs nobody in and caches nothing. */
export function useCreateAccount() {
  return useMutation({
    mutationKey: ["auth", "create-account"],
    mutationFn: (details: AccountDetails) => createAccount(details),
  });
}

function useEndSession(end: (csrfToken: string) => Promise<void>, key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["auth", key],
    mutationFn: async () => {
      const session = queryClient.getQueryData<Session | null>(sessionQueryKey);
      if (session) await end(session.csrfToken);
    },
    // Signed out locally even if the request failed; the server session then
    // expires on its own, and the next sign-in rotates it.
    onSettled: () => endLocalSession(queryClient),
  });
}

export const useSignOut = () => useEndSession(signOut, "sign-out");
export const useSignOutEverywhere = () => useEndSession(signOutEverywhere, "sign-out-everywhere");
