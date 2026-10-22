import { defineConfig } from 'vitest/config';

// Frontend tests: jsdom + React Testing Library, with the backend API mocked
// by msw (src/test/fakeApi.ts) in either cart mode: the legacy shared MongoDB
// cart or PostgreSQL per-user carts.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
