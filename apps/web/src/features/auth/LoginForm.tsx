"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useReturnPath } from "@/hooks/useReturnPath";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { noticeDismissed } from "@/store/uiSlice";
import { useSignIn } from "./hooks";

export function LoginForm() {
  const router = useRouter();
  const returnPath = useReturnPath();
  const signIn = useSignIn();
  const notice = useAppSelector((state) => state.ui.notice);
  const dispatch = useAppDispatch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    signIn.mutate({ email, password }, {
      onSuccess: () => {
        dispatch(noticeDismissed());
        router.replace(returnPath);
      },
    });
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4" noValidate>
      {notice && <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 font-normal"
        />
      </label>
      {signIn.isError && (
        <p role="alert" className="text-sm text-red-700">{signIn.error.message}</p>
      )}
      <button
        type="submit"
        disabled={signIn.isPending}
        className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
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
