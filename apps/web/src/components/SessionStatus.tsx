"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, useSignOut } from "@/features/auth/hooks";

export function SessionStatus() {
  const session = useSession();
  const signOut = useSignOut();
  const pathname = usePathname();

  if (session.isPending) return <span className="text-sm text-slate-300">…</span>;

  if (!session.data) {
    const from = pathname === "/login" ? "" : `?from=${encodeURIComponent(pathname)}`;
    return <Link href={`/login${from}`} className="text-sm font-medium underline-offset-4 hover:underline">Sign in</Link>;
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span>Hello, {session.data.user.name}</span>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="rounded-md border border-white/40 px-3 py-1 hover:bg-white/10 disabled:opacity-60"
      >
        Sign out
      </button>
    </div>
  );
}
