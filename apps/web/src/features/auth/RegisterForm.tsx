"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useReturnPath } from "@/hooks/useReturnPath";
import { ApiError } from "@/lib/api/client";
import { useAppDispatch } from "@/store/hooks";
import { noticeShown } from "@/store/uiSlice";
import { describedBy, fieldClass, FieldError, looksLikeEmail } from "./fields";
import { useCreateAccount } from "./hooks";
import { NOTICES } from "./notices";

type Field = "name" | "email" | "password" | "confirmPassword";
type RegisterErrors = Partial<Record<Field, string>>;
const ORDER: Field[] = ["name", "email", "password", "confirmPassword"];

/** The same checks as the Vite form (the API validates again), one message per field. */
function validate(values: Record<Field, string>): RegisterErrors {
  return {
    name: values.name.trim() ? undefined : "Enter your name.",
    email: !values.email.trim() ? "Enter your email address." : !looksLikeEmail(values.email) ? "Enter an email address such as name@example.com." : undefined,
    password: values.password.length < 8 ? "Use at least 8 characters." : undefined,
    confirmPassword: !values.confirmPassword ? "Enter the password again." : values.confirmPassword !== values.password ? "Passwords do not match." : undefined,
  };
}

/**
 * Creates the account, then sends the user to the normal cookie-session
 * sign-in (no token is issued here and nothing is stored in the browser).
 */
export function RegisterForm() {
  const router = useRouter();
  const returnPath = useReturnPath();
  const dispatch = useAppDispatch();
  const createAccount = useCreateAccount();
  const [values, setValues] = useState<Record<Field, string>>({ name: "", email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<RegisterErrors>({});
  const loginHref = returnPath === "/" ? "/login" : `/login?from=${encodeURIComponent(returnPath)}`;

  // An address that is already registered belongs to the email field; other failures to the form.
  const emailTaken = createAccount.error instanceof ApiError && createAccount.error.status === 409;
  const fieldError = (field: Field) => errors[field] ?? (field === "email" && emailTaken ? createAccount.error?.message : undefined);
  const formError = createAccount.isError && !emailTaken ? createAccount.error.message : "";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    const first = ORDER.find((field) => found[field]);
    if (first) {
      document.getElementById(`register-${first}`)?.focus();
      return;
    }
    createAccount.mutate({ name: values.name, email: values.email, password: values.password }, {
      onSuccess: () => {
        dispatch(noticeShown(NOTICES.accountCreated));
        router.push(loginHref);
      },
      onError: (error) => document.getElementById(error instanceof ApiError && error.status === 409 ? "register-email" : "register-form-error")?.focus(),
    });
  };

  const input = (field: Field, label: string, props: { type: string; autoComplete: string; hint?: string }) => {
    const message = fieldError(field);
    return (
      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor={`register-${field}`}>{label}</label>
        {props.hint && <span id={`register-${field}-hint`} className="font-normal text-slate-600">{props.hint}</span>}
        <input
          id={`register-${field}`}
          type={props.type}
          autoComplete={props.autoComplete}
          required
          value={values[field]}
          onChange={(event) => {
            const { value } = event.target;
            setValues((current) => ({ ...current, [field]: value }));
            setErrors((current) => ({ ...current, [field]: undefined }));
          }}
          aria-invalid={message ? true : undefined}
          aria-describedby={describedBy(props.hint && `register-${field}-hint`, message && `register-${field}-error`)}
          className={fieldClass}
        />
        <FieldError id={`register-${field}-error`} message={message} />
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4" noValidate>
      {formError && <p id="register-form-error" tabIndex={-1} role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{formError}</p>}
      {input("name", "Name", { type: "text", autoComplete: "name" })}
      {input("email", "Email", { type: "email", autoComplete: "email" })}
      {input("password", "Password", { type: "password", autoComplete: "new-password", hint: "At least 8 characters." })}
      {input("confirmPassword", "Confirm password", { type: "password", autoComplete: "new-password" })}
      <button
        type="submit"
        disabled={createAccount.isPending}
        className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#198754] disabled:opacity-60"
      >
        {createAccount.isPending ? "Creating account…" : "Create account"}
      </button>
      <p className="text-center text-sm">
        Already have an account? <Link href={loginHref} className="font-medium text-[#198754] underline underline-offset-4">Sign in</Link>
      </p>
    </form>
  );
}
