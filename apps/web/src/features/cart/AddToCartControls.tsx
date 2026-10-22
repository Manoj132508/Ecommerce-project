"use client";

// Limited cart integration for the product pages: add a product to the
// signed-in user's cart. The cart and checkout pages move to Next.js in the
// next stage.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { endLocalSession, useSession } from "@/features/auth/hooks";
import { NOTICES } from "@/features/auth/notices";
import { ApiError, apiFetch } from "@/lib/api/client";
import { cartQueryRoot, checkoutQueryRoot } from "@/lib/queryKeys";
import { refetchAfterWrite } from "@/lib/refetchAfterWrite";
import { safeReturnPath } from "@/lib/returnPath";
import { useAppDispatch } from "@/store/hooks";
import { noticeShown } from "@/store/uiSlice";

interface AddToCartControlsProps {
  productId: string;
  productName: string;
  /** Where to come back to after signing in (the current page). */
  returnTo: string;
  compact?: boolean;
}

/** Quantities the API accepts (FD1: whole numbers 1 to 10). */
const QUANTITIES = Array.from({ length: 10 }, (_, index) => index + 1);

export function AddToCartControls({ productId, productName, returnTo, compact = false }: AddToCartControlsProps) {
  const session = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const selectId = useId();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const sendToSignIn = (notice: string) => {
    dispatch(noticeShown(notice));
    router.push(`/login?from=${encodeURIComponent(safeReturnPath(returnTo))}`);
  };

  const add = useMutation({
    mutationKey: ["cart", "add"],
    mutationFn: (csrfToken: string) => apiFetch("/cart-items", { method: "POST", body: { productId, quantity }, csrfToken }),
    onSuccess: () => {
      void refetchAfterWrite(queryClient, [cartQueryRoot, checkoutQueryRoot]);
      setAdded(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAdded(false), 2000);
    },
    onError: (error) => {
      setAdded(false);
      if (error instanceof ApiError && error.status === 401) {
        endLocalSession(queryClient);
        sendToSignIn(NOTICES.sessionExpired);
      }
    },
  });

  const onAdd = () => {
    const csrfToken = session.data?.csrfToken;
    if (!csrfToken) {
      sendToSignIn(NOTICES.cartLogin);
      return;
    }
    add.mutate(csrfToken);
  };

  const failure = add.isError && !(add.error instanceof ApiError && add.error.status === 401) ? add.error.message : "";

  return (
    <div className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className={compact ? "sr-only" : "font-semibold"}>
          Quantity{compact ? ` for ${productName}` : ":"}
        </label>
        <select
          id={selectId}
          value={quantity}
          onChange={(event) => { setQuantity(Number(event.target.value)); setAdded(false); }}
          className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1"
        >
          {QUANTITIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <p aria-live="polite" className={`min-h-6 text-[#198754] ${compact ? "text-sm" : ""}`}>
        {added ? `Added ${quantity} to your cart` : ""}
      </p>
      {failure && <p role="alert" className="text-sm text-red-700">{failure}</p>}
      <button
        type="button"
        onClick={onAdd}
        disabled={add.isPending || session.isPending}
        aria-label={compact ? `Add ${productName} to cart` : undefined}
        className={`rounded-full bg-[#ffd814] font-semibold text-[#0f1111] hover:bg-[#f7ca00] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#198754] disabled:opacity-60 ${compact ? "w-full px-3 py-2 text-sm" : "w-full px-6 py-3 sm:max-w-sm"}`}
      >
        {add.isPending ? "Adding…" : "Add to Cart"}
      </button>
    </div>
  );
}
