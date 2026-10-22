"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSession, useSignOut } from "@/features/auth/hooks";
import { useCartQuery } from "@/features/cart/hooks";
import { CartDrawer } from "@/features/cart/CartDrawer";
import { useHydrated } from "@/hooks/useHydrated";
import { safeReturnPath } from "@/lib/returnPath";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { cartDrawerOpened, menuClosed, menuToggled } from "@/store/uiSlice";

const linkClass = "rounded px-3 py-2 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white";

export function SessionStatusPlaceholder() {
  return <span className="px-3 text-sm text-white/70">…</span>;
}

export function SessionStatus() {
  // The server always renders the placeholder (no session there yet).
  const hydrated = useHydrated();
  const session = useSession();
  const signOut = useSignOut();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  const cart = useCartQuery();
  const dispatch = useAppDispatch();
  const menuOpen = useAppSelector((state) => state.ui.menuOpen);
  const menuButton = useRef<HTMLButtonElement>(null);
  const totalQuantity = (cart.data ?? []).reduce((total, item) => total + item.quantity, 0);

  // The menu belongs to the page it was opened on.
  useEffect(() => { dispatch(menuClosed()); }, [dispatch, pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dispatch(menuClosed());
      menuButton.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, menuOpen]);

  if (!hydrated || session.isPending) return <SessionStatusPlaceholder />;

  if (!session.data) {
    // Come back to this page, with its search, after signing in (never to the sign-in pages themselves).
    const current = safeReturnPath(search ? `${pathname}?${search}` : pathname, "");
    const from = current && current !== "/" ? `?from=${encodeURIComponent(current)}` : "";
    return (
      <nav aria-label="Main navigation" className="flex items-center gap-1">
        <Link href={`/login${from}`} className={linkClass}>Sign in</Link>
        <Link href={`/register${from}`} className={linkClass}>Register</Link>
      </nav>
    );
  }

  const signOutAndRefresh = () => signOut.mutate(undefined, { onSettled: () => router.refresh() });

  return (
    <>
      <nav aria-label="Main navigation" className="relative flex items-center gap-1 text-sm sm:text-base">
        <div className="hidden items-center gap-1 xl:flex">
          <Link href="/cart" className={linkClass}>Cart ({totalQuantity})</Link>
          <button
            type="button"
            // Safari does not focus a clicked button; the drawer returns focus to it on close.
            onClick={(event) => { event.currentTarget.focus(); dispatch(cartDrawerOpened()); }}
            className={linkClass}
            aria-label={`Open cart drawer with ${totalQuantity} items`}
          >
            Preview
          </button>
          <Link href="/checkout" className={linkClass}>Checkout</Link>
          <Link href="/orders" className={linkClass}>Orders</Link>
          <Link href="/account" className={`${linkClass} max-w-40 truncate`}>{session.data.user.name}</Link>
          <button
            type="button"
            onClick={signOutAndRefresh}
            disabled={signOut.isPending}
            className="rounded bg-red-600 px-3 py-2 font-semibold hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60"
          >
            Sign out
          </button>
        </div>
        <button ref={menuButton} type="button" onClick={() => dispatch(menuToggled())} aria-expanded={menuOpen} aria-controls="mobile-navigation" className="rounded border border-white/70 px-3 py-2 font-semibold xl:hidden">Menu ({totalQuantity})</button>
        {menuOpen && (
          <div id="mobile-navigation" className="absolute right-0 top-full z-40 mt-2 grid w-52 gap-1 rounded bg-[#084f2d] p-2 shadow-xl xl:hidden">
            <Link href="/cart" onClick={() => dispatch(menuClosed())} className={linkClass}>Cart ({totalQuantity})</Link>
            <button
              type="button"
              // The menu closes, so the drawer returns focus to the Menu button.
              onClick={() => { menuButton.current?.focus(); dispatch(menuClosed()); dispatch(cartDrawerOpened()); }}
              className={`${linkClass} text-left`}
            >
              Cart preview
            </button>
            <Link href="/checkout" onClick={() => dispatch(menuClosed())} className={linkClass}>Checkout</Link>
            <Link href="/orders" onClick={() => dispatch(menuClosed())} className={linkClass}>Orders</Link>
            <Link href="/account" onClick={() => dispatch(menuClosed())} className={linkClass}>Account</Link>
            <button type="button" onClick={signOutAndRefresh} className="rounded bg-red-600 px-3 py-2 text-left font-semibold">Sign out</button>
          </div>
        )}
      </nav>
      <CartDrawer />
    </>
  );
}
