// Messages shown on the sign-in page. Kept in Redux (UI state) while the user
// moves between pages, never in the URL.
export const NOTICES = {
  cartLogin: "Sign in to add products to your cart.",
  sessionExpired: "Your session has expired. Please sign in again.",
  accountCreated: "Your account has been created. Sign in to continue.",
  loginRequired: "Please sign in to continue.",
  otherDevicesNotSignedOut: "You are signed out on this device, but your other devices could not be signed out. Sign in and try again from your account.",
} as const;
