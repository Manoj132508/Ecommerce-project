"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, useSignOut } from "@/features/auth/hooks";

const linkClass = "rounded px-3 py-2 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white";

export function SessionStatus() {
  const session = useSession();
  const signOut = useSignOut();
  const pathname = usePathname();
  const router = useRouter();

  if (session.isPending) return <span className="px-3 text-sm text-white/70">…</span>;

  if (!session.data) {
    // Come back to this page after signing in (not to the sign-in pages themselves).
    const from = pathname === "/login" || pathname === "/register" ? "" : `?from=${encodeURIComponent(pathname)}`;
    return (
      <div className="flex items-center gap-1">
        <Link href={`/login${from}`} className={linkClass}>Sign in</Link>
        <Link href={`/register${from}`} className={linkClass}>Register</Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 text-sm sm:text-base">
      <Link href="/account" className={`${linkClass} max-w-40 truncate`}>{session.data.user.name}</Link>
      <button
        type="button"
        onClick={() => signOut.mutate(undefined, { onSettled: () => router.refresh() })}
        disabled={signOut.isPending}
        className="rounded bg-red-600 px-3 py-2 font-semibold hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60"
      >
        Sign out
      </button>
    </div>
  );
}
