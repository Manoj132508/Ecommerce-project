"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { safeReturnPath } from "@/lib/returnPath";
import { useAppDispatch } from "@/store/hooks";
import { noticeShown } from "@/store/uiSlice";
import { endLocalSession } from "./hooks";
import { NOTICES } from "./notices";
import { SESSION_EXPIRED_EVENT } from "./sessionExpiry";

export function SessionExpiryWatcher() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useAppDispatch();

  useEffect(() => {
    const expired = () => {
      endLocalSession(queryClient);
      dispatch(noticeShown(NOTICES.sessionExpired));
      const from = safeReturnPath(pathname, "/");
      router.replace(`/login?from=${encodeURIComponent(from)}`);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [dispatch, pathname, queryClient, router]);

  return null;
}
