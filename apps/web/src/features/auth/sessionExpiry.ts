export const SESSION_EXPIRED_EVENT = "ecommerce:session-expired";

export function announceSessionExpired() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}
