import "server-only";
import { parseOrder, type Order } from "@/features/orders/api";
import { serverEnv } from "@/lib/env/server";
import { getServerSessionCookieHeader } from "./session";

export type ServerOrderResult =
  | { kind: "found"; order: Order }
  | { kind: "signed-out" }
  | { kind: "not-found" };

/** The signed-in user's own order (also for an admin: scope=own). Ownership is checked by Express; never cached. */
export async function getServerOrder(orderId: string): Promise<ServerOrderResult> {
  const cookie = await getServerSessionCookieHeader();
  if (!cookie) return { kind: "signed-out" };
  const response = await fetch(new URL(`/api/orders/${encodeURIComponent(orderId)}?scope=own&expand=products`, serverEnv().backendOrigin), {
    headers: { Accept: "application/json", Cookie: cookie },
    cache: "no-store",
  });
  if (response.status === 401) return { kind: "signed-out" };
  if (response.status === 404) return { kind: "not-found" };
  if (!response.ok) throw new Error("The order could not be loaded.");
  return { kind: "found", order: parseOrder(await response.json()) };
}
