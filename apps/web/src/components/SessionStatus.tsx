"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CartIcon, CloseIcon, MenuIcon, PanelIcon } from "@/components/ui/icons";
import { useSession, useSignOut } from "@/features/auth/hooks";
import { useCartQuery } from "@/features/cart/hooks";
import { CartDrawer } from "@/features/cart/CartDrawer";
import { useHydrated } from "@/hooks/useHydrated";
import { safeReturnPath } from "@/lib/returnPath";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { cartDrawerOpened, menuClosed, menuToggled } from "@/store/uiSlice";

// The header sets --ring to white, so focus rings stay visible on the brand colour.
const linkClass = buttonVariants({ variant: "inverse" });
const menuLinkClass = cn(buttonVariants({ variant: "inverse" }), "w-full justify-start text-base");
const cartLinkClass = cn(buttonVariants({ variant: "secondary" }), "text-brand");

export function SessionStatusPlaceholder() {
  return <span className="inline-flex min-h-11 items-center px-3 text-sm text-white/80 lg:min-h-10">…</span>;
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
        <Link href={`/register${from}`} className={cartLinkClass}>Register</Link>
      </nav>
    );
  }

  const signOutAndRefresh = () => signOut.mutate(undefined, { onSettled: () => router.refresh() });

  return (
    <>
      <nav aria-label="Main navigation" className="flex items-center gap-1">
        <div className="hidden items-center gap-1 xl:flex">
          <Link href="/orders" className={linkClass}>Orders</Link>
          {session.data.user.isAdmin && <Link href="/admin" className={linkClass}>Admin</Link>}
          <Link href="/account" className={cn(linkClass, "max-w-40")}><span className="truncate">{session.data.user.name}</span></Link>
          <Link href="/checkout" className={linkClass}>Checkout</Link>
          <button
            type="button"
            // Safari does not focus a clicked button; the drawer returns focus to it on close.
            onClick={(event) => { event.currentTarget.focus(); dispatch(cartDrawerOpened()); }}
            className={buttonVariants({ variant: "inverse", size: "icon" })}
            aria-label={`Open cart drawer with ${totalQuantity} items`}
            title="Cart preview"
          >
            <PanelIcon />
          </button>
          <Link href="/cart" aria-label={`Cart (${totalQuantity})`} className={cartLinkClass}>
            <CartIcon />
            Cart
            <Badge aria-hidden="true" className="min-w-5">{totalQuantity}</Badge>
          </Link>
          <button
            type="button"
            onClick={signOutAndRefresh}
            disabled={signOut.isPending}
            className={cn(linkClass, "border border-white/50")}
          >
            Sign out
          </button>
        </div>
        <button
          ref={menuButton}
          type="button"
          onClick={() => dispatch(menuToggled())}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          aria-label={`Menu (${totalQuantity})`}
          className={cn(linkClass, "border border-white/50 xl:hidden")}
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
          Menu
          <Badge variant="inverse" aria-hidden="true" className="min-w-5">{totalQuantity}</Badge>
        </button>
        {menuOpen && (
          // A disclosure panel under the header (not a modal): Escape or the
          // Menu button closes it and focus returns to the button.
          <div id="mobile-navigation" className="absolute inset-x-0 top-full z-40 border-t border-white/15 bg-brand shadow-lg xl:hidden">
            <ul className="mx-auto grid w-full max-w-7xl gap-1 px-4 py-3 sm:grid-cols-2 sm:px-6">
              <li><Link href="/cart" onClick={() => dispatch(menuClosed())} className={menuLinkClass}>Cart ({totalQuantity})</Link></li>
              <li>
                <button
                  type="button"
                  // The menu closes, so the drawer returns focus to the Menu button.
                  onClick={() => { menuButton.current?.focus(); dispatch(menuClosed()); dispatch(cartDrawerOpened()); }}
                  className={menuLinkClass}
                >
                  Cart preview
                </button>
              </li>
              <li><Link href="/checkout" onClick={() => dispatch(menuClosed())} className={menuLinkClass}>Checkout</Link></li>
              <li><Link href="/orders" onClick={() => dispatch(menuClosed())} className={menuLinkClass}>Orders</Link></li>
              {session.data.user.isAdmin && <li><Link href="/admin" onClick={() => dispatch(menuClosed())} className={menuLinkClass}>Admin</Link></li>}
              <li><Link href="/account" onClick={() => dispatch(menuClosed())} className={menuLinkClass}>Account</Link></li>
              <li className="border-t border-white/15 pt-2 sm:col-span-2">
                <button type="button" onClick={signOutAndRefresh} disabled={signOut.isPending} className={menuLinkClass}>Sign out</button>
              </li>
            </ul>
          </div>
        )}
      </nav>
      <CartDrawer />
    </>
  );
}
