import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/features/catalog/ProductImage";
import { formatMoney } from "@/features/catalog/product";
import { formatDeliveryDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CartItem, DeliveryOption } from "./api";
import { QuantitySelector } from "./QuantitySelector";

const productHref = (productId: string) => `/products/${encodeURIComponent(productId)}`;

/**
 * Current catalogue price × quantity, for display on the line only. The order
 * total always comes from the API's payment summary (OrderSummary).
 */
const lineTotal = (item: CartItem) => (item.product ? formatMoney(item.product.priceCents * item.quantity) : null);

function Thumbnail({ item, size }: { item: CartItem; size: "sm" | "md" }) {
  const box = size === "sm" ? "w-16" : "w-20 sm:w-24";
  if (!item.product) {
    return <div aria-hidden="true" className={cn("aspect-square shrink-0 rounded-sm bg-secondary", box)} />;
  }
  return (
    <div className={cn("shrink-0 rounded-sm bg-surface p-1.5", box)}>
      <ProductImage product={item.product} decorative sizes={size === "sm" ? "64px" : "96px"} />
    </div>
  );
}

/** A deleted product stays in the cart until the customer removes it; checkout is blocked meanwhile. */
function UnavailableNotice({ onRemove, busy, compact }: { onRemove?: () => void; busy?: boolean; compact?: boolean }) {
  return (
    <Alert variant="destructive" className={compact ? "px-3 py-2" : undefined}>
      <p>{compact ? "Remove this unavailable item before checkout." : "It stays in your cart so nothing disappears without your action. Remove it to continue to checkout."}</p>
      {onRemove && (
        <div><Button variant="destructive" size="sm" onClick={onRemove} disabled={busy} className="mt-2">Remove unavailable item</Button></div>
      )}
    </Alert>
  );
}

/** Cart page row: photo, name, unit and line price, quantity 1–10, delivery option and remove. */
export function CartLineRow({ item, deliveryOptions, busy, onQuantity, onDelivery, onRemove }: {
  item: CartItem;
  deliveryOptions?: DeliveryOption[];
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onDelivery: (deliveryOptionId: string) => void;
  onRemove: () => void;
}) {
  const { product } = item;
  if (!product) {
    return (
      <li className="flex gap-4 py-5">
        <Thumbnail item={item} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h2 className="font-semibold">This product is no longer available</h2>
          <UnavailableNotice onRemove={onRemove} busy={busy} />
        </div>
      </li>
    );
  }
  const quantityId = `quantity-${item.productId}`;
  const delivery = deliveryOptions?.find((option) => option.id === item.deliveryOptionId);
  return (
    <li className="flex gap-4 py-5">
      <Link href={productHref(item.productId)} tabIndex={-1} aria-hidden="true" className="self-start">
        <Thumbnail item={item} size="md" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h2 className="font-semibold leading-snug">
              <Link href={productHref(item.productId)} className="focus-ring rounded-sm hover:text-primary hover:underline hover:underline-offset-4">{product.name}</Link>
            </h2>
            <p className="text-sm tabular-nums text-muted-foreground">{formatMoney(product.priceCents)} each</p>
          </div>
          <p className="font-semibold tabular-nums"><span className="sr-only">Item total: </span>{lineTotal(item)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label htmlFor={quantityId} className="text-sm font-medium">
            Quantity{" "}<span className="sr-only">for {product.name}</span>
          </label>
          <QuantitySelector id={quantityId} value={item.quantity} disabled={busy} onChange={onQuantity} className="w-20" />
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy} aria-label={`Remove ${product.name}`} className="text-destructive hover:bg-destructive/5">
            Remove
          </Button>
        </div>

        {item.unavailable && <UnavailableNotice onRemove={onRemove} busy={busy} />}

        {deliveryOptions && deliveryOptions.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">
              Delivery option{" "}<span className="sr-only">for {product.name}</span>
              {delivery && <span className="ml-2 font-normal text-success-foreground">Arrives {formatDeliveryDay(delivery.estimatedDeliveryTimeMs)}</span>}
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {deliveryOptions.map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-start gap-2 rounded-sm border border-border p-3 text-sm transition-colors hover:border-primary has-checked:border-primary has-checked:bg-accent has-disabled:cursor-not-allowed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
                >
                  <input
                    type="radio"
                    name={`delivery-${item.productId}`}
                    checked={option.id === item.deliveryOptionId}
                    disabled={busy}
                    onChange={() => onDelivery(option.id)}
                    className="mt-0.5 size-4 accent-primary focus:outline-none"
                  />
                  <span>
                    <span className="block font-medium">{formatDeliveryDay(option.estimatedDeliveryTimeMs)}</span>
                    <span className="block tabular-nums text-muted-foreground">{option.priceCents ? `${formatMoney(option.priceCents)} shipping` : "Free shipping"}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </li>
  );
}

/** Drawer and checkout review row: photo, name, quantity, delivery date and line price; read-only. */
export function CartLineCompact({ item, deliveryOptions, onNavigate, headingLevel = 3 }: {
  item: CartItem;
  deliveryOptions?: DeliveryOption[];
  /** Called when the product link is followed (the drawer closes). */
  onNavigate?: () => void;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const delivery = deliveryOptions?.find((option) => option.id === item.deliveryOptionId);
  return (
    <li className="flex gap-3 py-4">
      <Thumbnail item={item} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <Heading className="min-w-0 text-sm font-semibold leading-snug">
            {item.product ? (
              <Link href={productHref(item.productId)} onClick={onNavigate} className="focus-ring rounded-sm hover:text-primary hover:underline hover:underline-offset-4">{item.product.name}</Link>
            ) : "Product no longer available"}
          </Heading>
          {item.product && <p className="text-sm font-semibold tabular-nums"><span className="sr-only">Item total: </span>{lineTotal(item)}</p>}
        </div>
        <p className="text-sm text-muted-foreground">
          Quantity: {item.quantity}
          {delivery && <> · Arrives {formatDeliveryDay(delivery.estimatedDeliveryTimeMs)}</>}
        </p>
        {item.unavailable && <UnavailableNotice compact />}
      </div>
    </li>
  );
}
