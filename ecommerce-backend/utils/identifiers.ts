// Runtime guards for identifiers taken from requests (R18). A value must be a
// string in the entity's real format before it may reach a Mongoose query, so
// objects such as { "$ne": null }, arrays, numbers and malformed strings are
// rejected up front.
//
// Formats verified against every identifier in the development database on
// 2026-10-21 (and the model defaults); they differ per entity:
//   products._id, orders._id      UUID strings (crypto.randomUUID)
//   users._id, cartItems._id      MongoDB ObjectIds (24 hex characters)
//   deliveryOptions._id           short digit strings ("1", "2", "3")

// Canonical 8-4-4-4-12 hex form; any version, either case.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const DELIVERY_OPTION_ID_PATTERN = /^\d{1,10}$/;

const matches = (pattern: RegExp) => (value: unknown): value is string => (
  typeof value === "string" && pattern.test(value)
);

export const isProductId = matches(UUID_PATTERN);

export const isOrderId = matches(UUID_PATTERN);

export const isUserId = matches(OBJECT_ID_PATTERN);

export const isDeliveryOptionId = matches(DELIVERY_OPTION_ID_PATTERN);
