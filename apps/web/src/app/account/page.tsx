import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AccountActions } from "@/features/auth/AccountActions";
import { getServerSessionUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Your account" };

/**
 * Only what the session API returns about the account: name, email and role.
 * There is no profile editing, address book or saved payment method, so none
 * is shown.
 */
export default async function AccountPage() {
  const user = await getServerSessionUser();
  if (!user) redirect("/login?from=%2Faccount");

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your account</h1>

      <Card className="grid gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Profile</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-sm font-medium text-muted-foreground">Name</dt>
          <dd>{user.name}</dd>
          <dt className="text-sm font-medium text-muted-foreground">Email</dt>
          <dd className="[overflow-wrap:anywhere]">{user.email}</dd>
          <dt className="text-sm font-medium text-muted-foreground">Account type</dt>
          <dd><Badge variant={user.isAdmin ? "default" : "secondary"} className="px-2.5 py-0.5 text-sm">{user.isAdmin ? "Administrator" : "Customer"}</Badge></dd>
        </dl>
        <p className="text-sm text-muted-foreground">These details were given when the account was created. Changing them is not available in the store yet.</p>
      </Card>

      <Card className="grid gap-4 p-5 sm:p-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Signing in</h2>
          <p className="text-sm text-muted-foreground">
            Sign out ends the session in this browser. Sign out on all devices ends every session of this account, for example on a shared or lost device.
          </p>
        </div>
        <AccountActions />
      </Card>
    </div>
  );
}
