export const SESSION_EXPIRED_EVENT = "ecommerce:session-expired";

export function announceSessionExpired() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

// Cross-tab sign-in/sign-out (replaces the Vite app's localStorage "storage"
// event). The message carries no user data: other tabs only learn that the
// identity changed and ask the server who is signed in now.
const IDENTITY_CHANNEL = "ecommerce:identity";
const IDENTITY_CHANGED = "identity-changed";

// One channel per tab for sending and receiving: a BroadcastChannel never
// delivers a message to the instance that sent it, so a tab is not told
// about its own sign-in or sign-out.
let tabChannel: BroadcastChannel | null | undefined;
const channel = () => {
  if (tabChannel === undefined) tabChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(IDENTITY_CHANNEL);
  return tabChannel;
};

/** Tells the other open tabs of this site that the signed-in identity changed. */
export function broadcastIdentityChange() {
  channel()?.postMessage(IDENTITY_CHANGED);
}

/** Calls `onChange` when another tab signs in or out. Returns the unsubscribe function. */
export function subscribeIdentityChange(onChange: () => void): () => void {
  const shared = channel();
  if (!shared) return () => {};
  const onMessage = (event: MessageEvent) => {
    if (event.data === IDENTITY_CHANGED) onChange();
  };
  shared.addEventListener("message", onMessage);
  return () => shared.removeEventListener("message", onMessage);
}
