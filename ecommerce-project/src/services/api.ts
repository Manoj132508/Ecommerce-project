import axios from 'axios';

/** localStorage key of the bearer token (unchanged storage; see MIGRATION_PLAN.md R30). */
export const TOKEN_STORAGE_KEY = 'token';

let memoryToken: string | null = null;

export const getStoredToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || memoryToken;
  } catch {
    return memoryToken;
  }
};

export const setStoredToken = (token: string | null): void => {
  memoryToken = token || null;

  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // The current session can still work when browser storage is unavailable.
  }
};

export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (!axios.isAxiosError<{ message?: unknown }>(error)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  const message = error.response?.data?.message;
  return typeof message === 'string' && message ? message : fallback;
};

export const getErrorStatus = (error: unknown): number | undefined => (
  axios.isAxiosError(error) ? error.response?.status : undefined
);

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export default api;
