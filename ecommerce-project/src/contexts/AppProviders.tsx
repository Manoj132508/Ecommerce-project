import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Provider as ReduxProvider } from 'react-redux';
import type { PropsWithChildren } from 'react';
import { AuthSessionWatcher } from '../components/AuthSessionWatcher';
import { createQueryClient } from '../queries/queryClient';
import { store as appStore, type AppStore } from '../store/store';

const appQueryClient = createQueryClient();

interface AppProvidersProps extends PropsWithChildren {
  /** Tests pass fresh instances; the app uses the module-level ones. */
  queryClient?: QueryClient;
  store?: AppStore;
}

export function AppProviders({ children, queryClient = appQueryClient, store = appStore }: AppProvidersProps) {
  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <AuthSessionWatcher />
        {children}
      </QueryClientProvider>
    </ReduxProvider>
  );
}
