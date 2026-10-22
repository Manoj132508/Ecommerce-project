// Shared pieces of the sign-in and registration forms: one error message per
// field, linked to its input with aria-describedby (and aria-invalid set).

export const fieldClass = "rounded-md border border-slate-400 px-3 py-2 font-normal aria-[invalid=true]:border-red-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#198754]";

/** The ids of the descriptions that apply, or undefined when none does. */
export const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/** The same loose shape check as the API (one @, a dot in the domain, no spaces). */
export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="font-medium text-red-700">{message}</p>;
}
