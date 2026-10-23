import type { SessionUser } from "@/features/auth/api";
import { looksLikeEmail } from "@/features/auth/fields";
import type { CustomerDetails } from "@/features/orders/api";

export type CustomerField = keyof CustomerDetails;
export type CustomerErrors = Partial<Record<CustomerField, string>>;

/** Form order: the first field with an error receives focus. */
export const CUSTOMER_FIELDS: CustomerField[] = ["fullName", "email", "phone", "address", "city", "postalCode", "country"];

export const emptyCustomer = (user: SessionUser): CustomerDetails => ({
  fullName: user.name,
  email: user.email,
  phone: "",
  address: "",
  city: "",
  postalCode: "",
  country: "United Kingdom",
});

const MISSING: Record<CustomerField, string> = {
  fullName: "Enter your full name.",
  email: "Enter your email address.",
  phone: "Enter your phone number.",
  address: "Enter your street address.",
  city: "Enter your town or city.",
  postalCode: "Enter your postal code.",
  country: "Enter your country.",
};

/**
 * The same checks as POST /api/orders (every field non-empty after trimming,
 * a loose email shape), so problems are shown beside each field before
 * anything is sent. The server still validates on its own.
 */
export function validateCustomer(customer: CustomerDetails): CustomerErrors {
  const errors: CustomerErrors = {};
  for (const field of CUSTOMER_FIELDS) {
    if (!customer[field].trim()) errors[field] = MISSING[field];
  }
  if (!errors.email && !looksLikeEmail(customer.email)) errors.email = "Enter an email address in the format name@example.com.";
  return errors;
}
