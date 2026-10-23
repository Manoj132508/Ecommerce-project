"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppDispatch } from "@/store/hooks";
import { noticeShown } from "@/store/uiSlice";
import { useSignOut, useSignOutEverywhere } from "./hooks";
import { NOTICES } from "./notices";

/**
 * Sign out here, or everywhere (after a confirmation). Either way this browser
 * is signed out locally even if the request fails (hooks.ts); when ending the
 * other sessions failed, the sign-in page says so instead of pretending.
 */
export function AccountActions() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const signOut = useSignOut();
  const signOutEverywhere = useSignOutEverywhere();
  const [confirming, setConfirming] = useState(false);
  const everywhereButton = useRef<HTMLButtonElement>(null);
  const busy = signOut.isPending || signOutEverywhere.isPending;

  const endEverywhere = () => signOutEverywhere.mutate(undefined, {
    onSuccess: () => router.replace("/"),
    onError: () => {
      dispatch(noticeShown(NOTICES.otherDevicesNotSignedOut));
      router.replace("/login?from=%2Faccount");
    },
  });

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Button variant="outline" disabled={busy} aria-busy={signOut.isPending || undefined} onClick={() => signOut.mutate(undefined, { onSettled: () => router.replace("/") })}>
        {signOut.isPending ? "Signing out…" : "Sign out"}
      </Button>
      {/* Safari does not focus a clicked button; the dialog returns focus to it on close. */}
      <Button ref={everywhereButton} variant="destructive" disabled={busy} onClick={(event) => { event.currentTarget.focus(); setConfirming(true); }}>
        Sign out on all devices
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Sign out on all devices?"
        confirmLabel="Sign out everywhere"
        pendingLabel="Signing out…"
        cancelLabel="Stay signed in"
        pending={signOutEverywhere.isPending}
        onConfirm={endEverywhere}
        onCancel={() => setConfirming(false)}
        returnFocusTo={everywhereButton}
      >
        <p>Every browser and device signed in to this account is signed out, including this one. You can sign in again at any time.</p>
      </ConfirmDialog>
    </div>
  );
}
