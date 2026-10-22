// Renders a component with the app's real providers (Redux store + QueryClient),
// and a fake same-origin API that records every request.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { Provider } from "react-redux";
import { vi } from "vitest";
import type { Session } from "@/features/auth/api";
import { sessionQueryKey } from "@/lib/queryKeys";
import { makeStore, type AppStore } from "@/store/store";

export const ALICE = { _id: "6ad8b3e08afe6f8ad3173cac", name: "Alice", email: "alice@example.com", isAdmin: false };
export const SESSION: Session = { user: ALICE, csrfToken: "csrf-token-for-tests" };

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (request: RecordedRequest) => { status: number; body?: unknown };

/** Replaces fetch: "METHOD /api/path" → handler. Unknown routes fail the test with a 599. */
export function fakeApi(routes: Record<string, Handler | { status: number; body?: unknown }>) {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const recorded: RecordedRequest = { method, path, headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined };
    requests.push(recorded);
    const route = routes[`${method} ${path}`];
    const answer = typeof route === "function" ? route(recorded) : route ?? { status: 599, body: { message: `unexpected ${method} ${path}` } };
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.body ?? {}), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

export interface Rendered extends RenderResult {
  queryClient: QueryClient;
  store: AppStore;
  user: ReturnType<typeof userEvent.setup>;
}

/** session: undefined = not yet known (fetched through the fake API), null = signed out. */
export function renderWithProviders(ui: ReactElement, { session }: { session?: Session | null } = {}): Rendered {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (session !== undefined) queryClient.setQueryData(sessionQueryKey, session);
  const store = makeStore();
  const user = userEvent.setup();
  const result = render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </Provider>,
  );
  return { ...result, queryClient, store, user };
}

/** Everything the browser could persist or expose to scripts. */
export function browserStorageSnapshot(queryClient: QueryClient, store: AppStore) {
  return JSON.stringify({
    local: { ...window.localStorage },
    session: { ...window.sessionStorage },
    cookies: document.cookie,
    cache: queryClient.getQueryCache().getAll().map((query) => ({ key: query.queryKey, data: query.state.data })),
    redux: store.getState(),
  });
}
