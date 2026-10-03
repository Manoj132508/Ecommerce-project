import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { getErrorMessage, getStoredToken, setStoredToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(getStoredToken()));
  const [error, setError] = useState(null);
  const requestVersion = useRef(0);

  const clearError = useCallback(() => setError(null), []);

  const logout = useCallback(() => {
    requestVersion.current += 1;
    setStoredToken(null);
    setUser(null);
    setLoading(false);
    setError(null);
  }, []);

  const authenticate = useCallback(async (endpoint, details, fallback) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.post(endpoint, details);
      const { token, ...authenticatedUser } = data;

      if (!token) {
        throw new Error('The authentication response did not include a token');
      }

      if (version === requestVersion.current) {
        setStoredToken(token);
        setUser(authenticatedUser);
      }

      return { success: true, user: authenticatedUser };
    } catch (requestError) {
      const message = getErrorMessage(requestError, fallback);
      if (version === requestVersion.current) {
        setError(message);
      }
      return { success: false, error: message };
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, []);

  const register = useCallback((name, email, password) => {
    return authenticate('/auth/register', { name, email, password }, 'Unable to register. Please try again.');
  }, [authenticate]);

  const login = useCallback((email, password) => {
    return authenticate('/auth/login', { email, password }, 'Unable to log in. Please try again.');
  }, [authenticate]);

  const fetchUserProfile = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.get('/auth/profile');
      if (version === requestVersion.current) {
        setUser(data);
      }
      return { success: true, user: data };
    } catch (requestError) {
      const message = getErrorMessage(requestError, 'Unable to load your profile. Please try again.');
      if (version === requestVersion.current) {
        if ([401, 403].includes(requestError.response?.status)) {
          setStoredToken(null);
          setUser(null);
        }
        setError(message);
      }
      return { success: false, error: message };
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (getStoredToken()) {
      fetchUserProfile();
    }

    return () => {
      requestVersion.current += 1;
    };
  }, [fetchUserProfile]);

  const value = useMemo(() => ({
    user, loading, error, register, login, logout, fetchUserProfile, clearError
  }), [user, loading, error, register, login, logout, fetchUserProfile, clearError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
} 

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
