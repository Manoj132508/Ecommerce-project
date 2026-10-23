// Shared pieces of the sign-in and registration forms: one error message per
// field, linked to its input with aria-describedby (and aria-invalid set).

/** The ids of the descriptions that apply, or undefined when none does. */
export const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/** The same loose shape check as the API (one @, a dot in the domain, no spaces). */
export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="text-sm font-medium text-destructive">{message}</p>;
}

export function FieldHint({ id, children }: { id: string; children: string }) {
  return <p id={id} className="text-sm text-muted-foreground">{children}</p>;
}
