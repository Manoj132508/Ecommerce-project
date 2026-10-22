// Same-origin /api/* → Express (see src/lib/proxy/backendProxy.ts for the rules).
import { revalidateTag } from "next/cache";
import { serverEnv } from "@/lib/env/server";
import { proxyToBackend } from "@/lib/proxy/backendProxy";
import { changesCatalog } from "@/lib/proxy/catalogWrites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handler(request: Request): Promise<Response> {
  let environment: ReturnType<typeof serverEnv>;
  try {
    environment = serverEnv();
  } catch (error) {
    console.error("API proxy is not configured:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ message: "Server error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  const response = await proxyToBackend(request, environment);
  // The storefront caches the catalogue for 60 s; an admin change (a price,
  // a deleted product) must not be served from it afterwards.
  if (changesCatalog(request, response.status)) revalidateTag("catalog", { expire: 0 });
  return response;
}

export { handler as DELETE, handler as GET, handler as HEAD, handler as PATCH, handler as POST, handler as PUT };
