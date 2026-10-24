"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReturnPath } from "@/hooks/useReturnPath";
import { useValuesTypedBeforeHydration } from "@/hooks/useValuesTypedBeforeHydration";
import { ApiError } from "@/lib/api/client";
import { useAppDispatch } from "@/store/hooks";
import { noticeShown } from "@/store/uiSlice";
import { describedBy, FieldError, FieldHint, looksLikeEmail } from "./fields";
import { useCreateAccount } from "./hooks";
import { NOTICES } from "./notices";
import { PasswordInput } from "./PasswordInput";

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
  const [visible, setVisible] = useState<Partial<Record<Field, boolean>>>({});
  useValuesTypedBeforeHydration(Object.fromEntries(ORDER.map((field) => [
    `register-${field}`, (value: string) => setValues((current) => ({ ...current, [field]: value })),
  ])));
  const loginHref = returnPath === "/" ? "/login" : `/login?from=${encodeURIComponent(returnPath)}`;

  // An address that is already registered belongs to the email field; other failures to the form.
  const emailTaken = createAccount.error instanceof ApiError && createAccount.error.status === 409;
  const fieldError = (field: Field) => errors[field] ?? (field === "email" && emailTaken ? createAccount.error?.message : undefined);
  const formError = createAccount.isError && !emailTaken ? createAccount.error.message : "";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setVisible({});
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
    const id = `register-${field}`;
    const common = {
      id,
      autoComplete: props.autoComplete,
      required: true,
      value: values[field],
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        setValues((current) => ({ ...current, [field]: value }));
        setErrors((current) => ({ ...current, [field]: undefined }));
      },
      "aria-invalid": message ? true : undefined,
      "aria-describedby": describedBy(props.hint && `${id}-hint`, message && `${id}-error`),
    };
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {props.hint && <FieldHint id={`${id}-hint`}>{props.hint}</FieldHint>}
        {props.type === "password"
          ? <PasswordInput {...common} toggleName={field === "confirmPassword" ? "confirmed password" : "password"} visible={visible[field] ?? false} onVisibleChange={(shown) => setVisible((current) => ({ ...current, [field]: shown }))} />
          : <Input {...common} type={props.type} />}
        <FieldError id={`${id}-error`} message={message} />
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      {formError && <Alert id="register-form-error" tabIndex={-1} role="alert" variant="destructive" className="focus:outline-none">{formError}</Alert>}
      {input("name", "Name", { type: "text", autoComplete: "name" })}
      {input("email", "Email", { type: "email", autoComplete: "email" })}
      {input("password", "Password", { type: "password", autoComplete: "new-password", hint: "At least 8 characters." })}
      {input("confirmPassword", "Confirm password", { type: "password", autoComplete: "new-password" })}
      <Button type="submit" size="lg" disabled={createAccount.isPending} aria-busy={createAccount.isPending || undefined} className="w-full">
        {createAccount.isPending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={loginHref} className="focus-ring rounded-sm font-semibold text-primary underline underline-offset-4">Sign in</Link>
      </p>
    </form>
  );
}
