// Content-Security-Policy for every page (Phase 7A security review), set per
// request by src/proxy.ts with a fresh nonce. Next.js reads the nonce from the
// request's policy and puts it on its own scripts and styles; 'strict-dynamic'
// then lets those scripts load the app's chunks. Nothing else may run: no inline
// script, no eval, no script from another origin, no plugin, no framing.
//
// What the app needs and why each allowance exists:
//   connect-src 'self'   the browser calls only this host (/api/* is proxied server-side)
//   img-src https:       admins may set an off-site https product photo (shown unoptimised)
//   img-src data: blob:  next/image placeholders
//   style-src-attr       next/image and the tracking bar set style="" attributes;
//                        attributes cannot carry a nonce (CSS only, no script)
// Development only ('next dev'): React needs eval for its error overlay, and the
// dev server injects styles without a nonce and talks over a WebSocket.

export interface CspOptions {
  development: boolean;
}

/** 128 random bits, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(nonce: string, { development }: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : [])],
    "style-src": development ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`],
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(development ? ["ws:"] : [])],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}
