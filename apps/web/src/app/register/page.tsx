import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/features/auth/RegisterForm";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-center text-2xl font-bold">Create account</h1>
      {/* The form reads ?from= (useSearchParams), which needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
