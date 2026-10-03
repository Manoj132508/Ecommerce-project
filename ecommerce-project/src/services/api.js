import axios from 'axios';

let memoryToken = null;

export const getStoredToken = () => {
  try {
    return localStorage.getItem('token') || memoryToken;
  } catch {
    return memoryToken;
  }
};

export const setStoredToken = (token) => {
  memoryToken = token || null;

  try {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  } catch {
    // The current session can still work when browser storage is unavailable.
  }
};

export const getErrorMessage = (error, fallback) => {
  const message = error.response?.data?.message;
  return typeof message === 'string' && message ? message : fallback;
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api'
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export default api;
