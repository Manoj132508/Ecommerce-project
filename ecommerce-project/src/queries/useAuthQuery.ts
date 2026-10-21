import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorStatus, getStoredToken, setStoredToken } from '../services/api';
import type {
  AuthResponse,
  AuthUser,
  LoginCredentials,
  RegisterDetails,
} from '../types/auth';

export const authQueryKey = ['auth', 'profile'] as const;

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

function clearUserScopedQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.removeQueries({
    predicate: (query) => ['cart', 'checkout', 'orders'].includes(String(query.queryKey[0])),
  });
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

export function useLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
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
    setStoredToken(null);
    queryClient.setQueryData(authQueryKey, null);
    clearUserScopedQueries(queryClient);
  }, [queryClient]);
}
