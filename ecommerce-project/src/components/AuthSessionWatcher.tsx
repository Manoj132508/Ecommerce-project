import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { authQueryKey, isAuthMutationKey, isUserScopedKey } from '../queries/queryKeys';
import { clearUserScopedQueries, endSession } from '../queries/useAuthQuery';
import { getErrorStatus, getStoredToken, TOKEN_STORAGE_KEY } from '../services/api';
import { LOGIN_REQUIRED_NOTICE, SESSION_EXPIRED_NOTICE, showAuthNotice } from '../slices/authUiSlice';
import { useAppDispatch } from '../store/hooks';

const AUTH_PAGES = ['/login', '/register'];

/**
 * Central handling of authentication failures (no UI of its own):
 * - A 401 from user-specific data (cart, checkout, orders) or from any
 *   mutation other than login/register ends the local session, clears that
 *   user's cached data and opens the login page with a safe return path.
 *   With the legacy shared MongoDB cart these requests never return 401, so
 *   its behaviour is unchanged.
 * - A 401 from the background profile check only clears data silently, as
 *   before; browsing public pages with an old token never forces a redirect.
 * - A sign-in or sign-out in another tab clears this tab's user data.
 */
export function AuthSessionWatcher() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const locationRef = useRef(location);
  locationRef.current = location;
  // Set when the background profile check finds the stored token expired, so
  // the next required login says "session expired" rather than "please log in".
  const sessionExpiredRef = useRef(false);

  useEffect(() => {
    const requireLogin = (error: unknown) => {
      if (getErrorStatus(error) !== 401) return;

      const hadSession = Boolean(getStoredToken()) || sessionExpiredRef.current;
      sessionExpiredRef.current = false;
      // Defer: the cache is mid-update when its listeners run.
      queueMicrotask(() => {
        endSession(queryClient);
        if (hadSession) {
          dispatch(showAuthNotice(SESSION_EXPIRED_NOTICE));
        }

        const { pathname, search } = locationRef.current;
        if (AUTH_PAGES.includes(pathname)) return;
        if (!hadSession) {
          dispatch(showAuthNotice(LOGIN_REQUIRED_NOTICE));
        }
        navigate('/login', { replace: true, state: { from: `${pathname}${search}` } });
      });
    };

    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'error') return;
      const { queryKey } = event.query;

      if (isUserScopedKey(queryKey)) {
        requireLogin(event.action.error);
      } else if (queryKey[0] === authQueryKey[0] && getErrorStatus(event.action.error) === 401) {
        sessionExpiredRef.current = true;
        queueMicrotask(() => clearUserScopedQueries(queryClient));
      }
    });

    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'error') return;
      if (isAuthMutationKey(event.mutation.options.mutationKey)) return;
      requireLogin(event.action.error);
    });

    const onStorage = (event: StorageEvent) => {
      if (event.key !== TOKEN_STORAGE_KEY && event.key !== null) return;
      clearUserScopedQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: authQueryKey });
    };
    window.addEventListener('storage', onStorage);

    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
      window.removeEventListener('storage', onStorage);
    };
  }, [dispatch, navigate, queryClient]);

  return null;
}
