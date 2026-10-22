// Admin data for Server Components. Every function checks the session on the
// server for this request; Express enforces adminOnly again on every call.
import "server-only";
import { notFound, redirect } from "next/navigation";
import type { SessionUser } from "@/features/auth/api";
import { parseProducts, type Product } from "@/features/catalog/product";
import { parseStatusEvents, type StatusEvent } from "@/features/admin/api";
import { parseOrder, type Order } from "@/features/orders/api";
import { serverEnv } from "@/lib/env/server";
import { getServerSessionCookieHeader, getServerSessionUser } from "./session";

/**
 * The signed-in administrator, or: signed out → sign-in with a return path;
 * signed in without the role → 404 (the admin area is not advertised).
 */
export async function requireAdmin(from: string): Promise<SessionUser> {
  const user = await getServerSessionUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(from)}`);
  if (!user.isAdmin) notFound();
  return user;
}

/** GET from Express with this request's session cookie; never cached. null: 404, or 501 (not supported by the data source). */
async function adminGet(path: string, from: string): Promise<unknown | null> {
  const cookie = await getServerSessionCookieHeader();
  if (!cookie) redirect(`/login?from=${encodeURIComponent(from)}`);
  const response = await fetch(new URL(path, serverEnv().backendOrigin), {
    headers: { Accept: "application/json", Cookie: cookie },
    cache: "no-store",
  });
  if (response.status === 401) redirect(`/login?from=${encodeURIComponent(from)}`);
  if (response.status === 403) notFound();
  if (response.status === 404 || response.status === 501) return null;
  if (!response.ok) throw new Error("Admin data could not be loaded.");
  return response.json();
}

/** The live catalogue (not the storefront's 60 s cache). */
export const getAdminProducts = async (from: string): Promise<Product[]> => parseProducts(await adminGet("/api/products", from));

/** Every order (admin view), newest first. */
export async function getAdminOrders(from: string): Promise<Order[]> {
  const data = await adminGet("/api/orders?expand=products", from);
  if (!Array.isArray(data)) throw new Error("Unexpected orders response.");
  return data.map(parseOrder);
}

export async function getAdminOrder(orderId: string, from: string): Promise<Order | null> {
  const data = await adminGet(`/api/orders/${encodeURIComponent(orderId)}?expand=products`, from);
  return data === null ? null : parseOrder(data);
}

/** null when the order is unknown or the order store keeps no history (MongoDB). */
export async function getOrderStatusEvents(orderId: string, from: string): Promise<StatusEvent[] | null> {
  const data = await adminGet(`/api/orders/${encodeURIComponent(orderId)}/status-events`, from);
  return data === null ? null : parseStatusEvents(data);
}
