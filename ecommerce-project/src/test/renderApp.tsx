import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router';
import App from '../App';
import { AppProviders } from '../contexts/AppProviders';
import { setStoredToken } from '../services/api';
import { makeStore } from '../store/store';

/** Renders the current location so tests can assert where the user ended up. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location" hidden>{`${location.pathname}${location.search}`}</output>;
}

/** The whole app (routes, Redux, TanStack Query, session watcher) with fresh state. */
export function renderApp({ path = '/', token }: { path?: InitialEntry; token?: string } = {}) {
  setStoredToken(token ?? null);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const store = makeStore();
  const user = userEvent.setup();

  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders queryClient={queryClient} store={store}>
        <App />
        <LocationProbe />
      </AppProviders>
    </MemoryRouter>,
  );

  return { ...result, queryClient, store, user };
}
