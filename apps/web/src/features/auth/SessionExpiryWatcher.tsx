"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { sessionQueryKey } from "@/lib/queryKeys";
import { safeReturnPath } from "@/lib/returnPath";
import { useAppDispatch } from "@/store/hooks";
import { noticeShown } from "@/store/uiSlice";
import { clearUserScopedQueries, endLocalSession } from "./hooks";
import { NOTICES } from "./notices";
import { SESSION_EXPIRED_EVENT, subscribeIdentityChange } from "./sessionExpiry";

export function SessionExpiryWatcher() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const dispatch = useAppDispatch();

  useEffect(() => {
    const expired = () => {
      endLocalSession(queryClient);
      dispatch(noticeShown(NOTICES.sessionExpired));
      // Read at the moment of expiry, so the search (?q=, ?placed=) comes back too.
      const current = `${window.location.pathname}${window.location.search}`;
      // A late 401 can arrive after a server guard has already sent this tab
      // to sign in; keep that page and its ?from= rather than resetting it to "/".
      if (safeReturnPath(current, "") === "") return;
      router.replace(`/login?from=${encodeURIComponent(current)}`);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [dispatch, queryClient, router]);

  useEffect(() => subscribeIdentityChange(() => {
    // Another tab signed in or out: forget this tab's user data, ask the
    // server who is signed in now, and let server guards re-run.
    clearUserScopedQueries(queryClient);
    void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    router.refresh();
  }), [queryClient, router]);

  return null;
}
