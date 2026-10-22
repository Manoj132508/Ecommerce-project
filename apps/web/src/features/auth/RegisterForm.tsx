"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useReturnPath } from "@/hooks/useReturnPath";
import { useAppDispatch } from "@/store/hooks";
import { noticeShown } from "@/store/uiSlice";
import { useCreateAccount } from "./hooks";
import { NOTICES } from "./notices";

const inputClass = "rounded-md border border-slate-300 px-3 py-2 font-normal";

/**
 * Creates the account, then sends the user to the normal cookie-session
 * sign-in (no token is issued here and nothing is stored in the browser).
 */
export function RegisterForm() {
  const router = useRouter();
  const returnPath = useReturnPath();
  const dispatch = useAppDispatch();
  const createAccount = useCreateAccount();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState("");

  const loginHref = returnPath === "/" ? "/login" : `/login?from=${encodeURIComponent(returnPath)}`;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError("");
    // The same checks as the Vite form; the API validates again.
    if (password !== confirmPassword) {
      setValidationError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setValidationError("Password must be at least 8 characters");
      return;
    }
    createAccount.mutate({ name, email, password }, {
      onSuccess: () => {
        dispatch(noticeShown(NOTICES.accountCreated));
        router.push(loginHref);
      },
    });
  };

  const error = validationError || (createAccount.isError ? createAccount.error.message : "");

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4" noValidate>
      {error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Name
        <input type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
      </label>
      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor="register-password">Password</label>
        <input id="register-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} aria-describedby="password-help" />
        <span id="password-help" className="font-normal text-slate-500">At least 8 characters.</span>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Confirm password
        <input type="password" autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={inputClass} />
      </label>
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
