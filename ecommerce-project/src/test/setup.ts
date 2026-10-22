import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setStoredToken } from '../services/api';
import { server } from './fakeApi';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  setStoredToken(null);
  localStorage.clear();
});

afterAll(() => server.close());
