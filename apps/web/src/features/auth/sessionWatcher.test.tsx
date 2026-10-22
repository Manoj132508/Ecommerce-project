// @vitest-environment jsdom
// Session expiry and cross-tab identity changes (the Vite app's AuthSessionWatcher).
import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { sessionQueryKey } from "@/lib/queryKeys";
import { navigation } from "@/test/navigation";
import { ALICE, fakeApi, renderWithProviders, SESSION } from "@/test/render";
import { NOTICES } from "./notices";
import { announceSessionExpired, broadcastIdentityChange, subscribeIdentityChange } from "./sessionExpiry";
import { SessionExpiryWatcher } from "./SessionExpiryWatcher";

afterEach(() => window.history.replaceState(null, "", "/"));

/** A second browser tab: its own channel instance on the same name. */
const otherTab = () => new BroadcastChannel("ecommerce:identity");

describe("session expiry", () => {
  test("ends the local session and returns to the same page, search included, after signing in", async () => {
    window.history.replaceState(null, "", "/orders/11111111-1111-4111-8111-111111111111?placed=1");
    fakeApi({});
    const { queryClient, store } = renderWithProviders(<SessionExpiryWatcher />, { session: SESSION });
    queryClient.setQueryData(["orders", ALICE._id], []);

    act(() => announceSessionExpired());

    expect(navigation.replace).toHaveBeenCalledWith(`/login?from=${encodeURIComponent("/orders/11111111-1111-4111-8111-111111111111?placed=1")}`);
    expect(queryClient.getQueryData(sessionQueryKey)).toBeNull();
    expect(queryClient.getQueryData(["orders", ALICE._id])).toBeUndefined();
    expect(store.getState().ui.notice).toBe(NOTICES.sessionExpired);
  });

  test("a late expiry on the sign-in page keeps its return path", async () => {
    window.history.replaceState(null, "", `/login?from=${encodeURIComponent("/orders")}`);
    fakeApi({});
    const { queryClient, store } = renderWithProviders(<SessionExpiryWatcher />, { session: SESSION });

    act(() => announceSessionExpired());

    expect(navigation.replace).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(sessionQueryKey)).toBeNull();
    expect(store.getState().ui.notice).toBe(NOTICES.sessionExpired);
  });
});

describe("another tab signs in or out", () => {
  test("this tab forgets the user's data, re-checks the session and refreshes server guards", async () => {
    fakeApi({});
    const { queryClient } = renderWithProviders(<SessionExpiryWatcher />, { session: SESSION });
    queryClient.setQueryData(["cart", ALICE._id], [{ productId: "p", quantity: 1 }]);

    const tab = otherTab();
    tab.postMessage("identity-changed");

    await waitFor(() => expect(navigation.refresh).toHaveBeenCalled());
    expect(queryClient.getQueryData(["cart", ALICE._id])).toBeUndefined();
    expect(queryClient.getQueryState(sessionQueryKey)?.isInvalidated).toBe(true);
    tab.close();
  });

  test("other tabs hear only a bare signal; this tab ignores its own; unsubscribing stops delivery", async () => {
    const received: unknown[] = [];
    const tab = otherTab();
    tab.onmessage = (event) => received.push(event.data);
    let calls = 0;
    const unsubscribe = subscribeIdentityChange(() => { calls += 1; });

    broadcastIdentityChange();
    await waitFor(() => expect(received).toEqual(["identity-changed"]));
    expect(calls).toBe(0);

    tab.postMessage("identity-changed");
    await waitFor(() => expect(calls).toBe(1));
    unsubscribe();
    tab.postMessage("identity-changed");
    tab.postMessage("flush");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
    tab.close();
  });
});
