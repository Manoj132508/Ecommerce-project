import { cn } from "@/lib/utils";

/** Quantities the API accepts (FD1: whole numbers 1 to 10). */
export const QUANTITIES = Array.from({ length: 10 }, (_, index) => index + 1);

/**
 * Quantity picker: a native <select> (the platform picker on phones, full
 * keyboard and screen-reader support), styled to match the other fields.
 */
export function QuantitySelector({ id, value, onChange, disabled, className }: {
  id: string;
  value: number;
  onChange: (quantity: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className={cn(
        "focus-ring min-h-11 cursor-pointer rounded-sm border border-input bg-background px-3 text-base tabular-nums text-foreground disabled:opacity-60 lg:min-h-10",
        className,
      )}
    >
      {QUANTITIES.map((quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}
    </select>
  );
}
