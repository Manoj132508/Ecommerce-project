"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useReturnPath } from "@/hooks/useReturnPath";
import { ApiError } from "@/lib/api/client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { noticeDismissed } from "@/store/uiSlice";
import { fieldClass, FieldError, describedBy, looksLikeEmail } from "./fields";
import { useSignIn } from "./hooks";

interface LoginErrors {
  email?: string;
  password?: string;
}

export function LoginForm() {
  const router = useRouter();
  const returnPath = useReturnPath();
  const signIn = useSignIn();
  const notice = useAppSelector((state) => state.ui.notice);
  const dispatch = useAppDispatch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  // Wrong credentials concern both fields; other server errors (rate limit, outage) neither.
  const credentialsRejected = signIn.error instanceof ApiError && signIn.error.status === 401;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: LoginErrors = {
      email: !email.trim() ? "Enter your email address." : !looksLikeEmail(email) ? "Enter an email address such as name@example.com." : undefined,
      password: password ? undefined : "Enter your password.",
    };
    setErrors(found);
    if (found.email) return emailInput.current?.focus();
    if (found.password) return passwordInput.current?.focus();
    signIn.mutate({ email, password }, {
      onSuccess: () => {
        dispatch(noticeDismissed());
        router.replace(returnPath);
      },
      onError: () => emailInput.current?.focus(),
    });
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4" noValidate>
      {notice && <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
      {signIn.isError && (
        <p id="login-error" role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{signIn.error.message}</p>
      )}
      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor="login-email">Email</label>
        <input
          ref={emailInput}
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => { setEmail(event.target.value); setErrors((current) => ({ ...current, email: undefined })); }}
          aria-invalid={errors.email || credentialsRejected ? true : undefined}
          aria-describedby={describedBy(errors.email && "login-email-error", credentialsRejected && "login-error")}
          className={fieldClass}
        />
        <FieldError id="login-email-error" message={errors.email} />
      </div>
      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor="login-password">Password</label>
        <input
          ref={passwordInput}
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: undefined })); }}
          aria-invalid={errors.password || credentialsRejected ? true : undefined}
          aria-describedby={describedBy(errors.password && "login-password-error", credentialsRejected && "login-error")}
          className={fieldClass}
        />
        <FieldError id="login-password-error" message={errors.password} />
      </div>
      <button
        type="submit"
        disabled={signIn.isPending}
        className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#198754] disabled:opacity-60"
      >
        {signIn.isPending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm">
        New here?{" "}
        <Link href={returnPath === "/" ? "/register" : `/register?from=${encodeURIComponent(returnPath)}`} className="font-medium text-[#198754] underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </form>
  );
}
