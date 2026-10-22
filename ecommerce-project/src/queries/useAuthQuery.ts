import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import api, { getErrorStatus, getStoredToken, setStoredToken } from '../services/api';
import type {
  AuthResponse,
  AuthUser,
  LoginCredentials,
  RegisterDetails,
} from '../types/auth';
import {
  authQueryKey,
  isUserScopedKey,
  loginMutationKey,
  registerMutationKey,
} from './queryKeys';

export { authQueryKey };

async function fetchUserProfile(): Promise<AuthUser> {
  try {
    const { data } = await api.get<AuthUser>('/auth/profile');
    return data;
  } catch (error) {
    if ([401, 403].includes(getErrorStatus(error) ?? 0)) {
      setStoredToken(null);
    }
    throw error;
  }
}

async function authenticate(
  endpoint: '/auth/login' | '/auth/register',
  details: LoginCredentials | RegisterDetails,
): Promise<AuthUser> {
  const { data } = await api.post<AuthResponse>(endpoint, details);

  if (!data.token) {
    throw new Error('The authentication response did not include a token.');
  }

  const { token, ...user } = data;
  setStoredToken(token);
  return user;
}

/** Removes every user's cart, checkout and order data from the cache. */
export function clearUserScopedQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => isUserScopedKey(query.queryKey) });
}

/** Ends the session locally: forgets the token, the user and their cached data. */
export function endSession(queryClient: QueryClient) {
  setStoredToken(null);
  queryClient.setQueryData(authQueryKey, null);
  clearUserScopedQueries(queryClient);
}

export function useAuthQuery() {
  const hasToken = Boolean(getStoredToken());

  return useQuery<AuthUser | null>({
    queryKey: authQueryKey,
    queryFn: fetchUserProfile,
    enabled: hasToken,
    initialData: hasToken ? undefined : null,
    retry: false,
  });
}

/**
 * The signed-in user's id (null when signed out) and whether it is known yet.
 * User-specific queries wait until it is known, so data fetched with a token
 * can never be cached under the wrong identity.
 */
export function useUserScope() {
  const { data, isPending } = useAuthQuery();
  return { userId: data?._id ?? null, identityKnown: !isPending };
}

export function useLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: loginMutationKey,
    mutationFn: (credentials: LoginCredentials) => authenticate('/auth/login', credentials),
    onSuccess: (user) => {
      clearUserScopedQueries(queryClient);
      queryClient.setQueryData(authQueryKey, user);
    },
  });
}

export function useRegisterMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: registerMutationKey,
    mutationFn: (details: RegisterDetails) => authenticate('/auth/register', details),
    onSuccess: (user) => {
      clearUserScopedQueries(queryClient);
      queryClient.setQueryData(authQueryKey, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    endSession(queryClient);
  }, [queryClient]);
}
