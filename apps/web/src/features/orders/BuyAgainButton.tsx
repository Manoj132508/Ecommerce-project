"use client";

import { useEffect, useRef, useState } from "react";
import { useAddCartItem } from "@/features/cart/hooks";
import { ApiError } from "@/lib/api/client";

/**
 * "Buy again" from an order line: adds one of the product to the cart, as the
 * Vite orders page did. A product that was deleted since (404) is explained
 * here instead of on the Vite /product-unavailable page.
 */
export function BuyAgainButton({ productId, productName }: { productId: string; productName?: string }) {
  const add = useAddCartItem();
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const buyAgain = () => add.mutate({ productId, quantity: 1 }, {
    onSuccess: () => {
      setAdded(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAdded(false), 2000);
    },
    onError: () => setAdded(false),
  });

  const gone = add.error instanceof ApiError && add.error.status === 404;
  const label = productName ? `Buy ${productName} again` : "Buy this product again";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={buyAgain}
        disabled={add.isPending}
        aria-label={label}
        className="rounded bg-[#198754] px-4 py-2 text-center font-semibold text-white hover:bg-[#126c45] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#198754] disabled:opacity-60"
      >
        {add.isPending ? "Adding…" : "Buy again"}
      </button>
      <p aria-live="polite" className="min-h-5 text-sm text-[#08783e]">{added ? "Added to your cart" : ""}</p>
      {add.isError && (
        <p role="alert" className="text-sm text-red-700">
          {gone
            ? `${productName ?? "This product"} is no longer available and cannot be added to your cart.`
            : add.error.message}
        </p>
      )}
    </div>
  );
}
