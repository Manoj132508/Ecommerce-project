import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountActions } from "@/features/auth/AccountActions";
import { getServerSessionUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await getServerSessionUser();
  if (!user) redirect("/login?from=%2Faccount");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Your account</h1>
      <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="font-medium text-slate-600">Name</dt>
        <dd>{user.name}</dd>
        <dt className="font-medium text-slate-600">Email</dt>
        <dd className="break-all">{user.email}</dd>
        <dt className="font-medium text-slate-600">Account type</dt>
        <dd>{user.isAdmin ? "Administrator" : "Customer"}</dd>
      </dl>
      <AccountActions />
    </div>
  );
}
