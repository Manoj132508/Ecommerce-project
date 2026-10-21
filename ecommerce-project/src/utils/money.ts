export function formatMoney(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}
