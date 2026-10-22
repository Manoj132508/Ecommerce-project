import Link from "next/link";
import { publicEnv } from "@/lib/env/public";
import { SessionStatus } from "./SessionStatus";

export function SiteHeader() {
  return (
    <header className="bg-slate-900 text-white">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3" aria-label="Main">
        <Link href="/" className="text-lg font-semibold">{publicEnv.appName}</Link>
        <SessionStatus />
      </nav>
    </header>
  );
}
