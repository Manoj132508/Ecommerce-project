"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReturnPath } from "@/hooks/useReturnPath";
import { useValuesTypedBeforeHydration } from "@/hooks/useValuesTypedBeforeHydration";
import { ApiError } from "@/lib/api/client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { noticeDismissed } from "@/store/uiSlice";
import { describedBy, FieldError, looksLikeEmail } from "./fields";
import { useSignIn } from "./hooks";
import { NOTICES } from "./notices";
import { PasswordInput } from "./PasswordInput";

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
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  useValuesTypedBeforeHydration({ "login-email": setEmail, "login-password": setPassword });

  // Wrong credentials concern both fields; other server errors (rate limit, outage) neither.
  const credentialsRejected = signIn.error instanceof ApiError && signIn.error.status === 401;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowPassword(false);
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
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      {notice && (
        <Alert role="status" variant={notice === NOTICES.accountCreated ? "success" : "warning"}>{notice}</Alert>
      )}
      {signIn.isError && <Alert id="login-error" role="alert" variant="destructive">{signIn.error.message}</Alert>}
      <div className="grid gap-1.5">
        <Label htmlFor="login-email">Email</Label>
        <Input
          ref={emailInput}
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => { setEmail(event.target.value); setErrors((current) => ({ ...current, email: undefined })); }}
          aria-invalid={errors.email || credentialsRejected ? true : undefined}
          aria-describedby={describedBy(errors.email && "login-email-error", credentialsRejected && "login-error")}
        />
        <FieldError id="login-email-error" message={errors.email} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="login-password">Password</Label>
        <PasswordInput
          ref={passwordInput}
          id="login-password"
          autoComplete="current-password"
          required
          value={password}
          visible={showPassword}
          onVisibleChange={setShowPassword}
          onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: undefined })); }}
          aria-invalid={errors.password || credentialsRejected ? true : undefined}
          aria-describedby={describedBy(errors.password && "login-password-error", credentialsRejected && "login-error")}
        />
        <FieldError id="login-password-error" message={errors.password} />
      </div>
      <Button type="submit" size="lg" disabled={signIn.isPending} aria-busy={signIn.isPending || undefined} className="w-full">
        {signIn.isPending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href={returnPath === "/" ? "/register" : `/register?from=${encodeURIComponent(returnPath)}`} className="focus-ring rounded-sm font-semibold text-primary underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </form>
  );
}
