"use client";

import { useRouter } from "next/navigation";
import { useSignOut, useSignOutEverywhere } from "./hooks";

export function AccountActions() {
  const router = useRouter();
  const signOut = useSignOut();
  const signOutEverywhere = useSignOutEverywhere();
  const busy = signOut.isPending || signOutEverywhere.isPending;
  const afterwards = { onSettled: () => router.replace("/") };

  return (
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => signOut.mutate(undefined, afterwards)} className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60">
        Sign out
      </button>
      <button type="button" disabled={busy} onClick={() => signOutEverywhere.mutate(undefined, afterwards)} className="rounded-md border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60">
        Sign out on all devices
      </button>
    </div>
  );
}
