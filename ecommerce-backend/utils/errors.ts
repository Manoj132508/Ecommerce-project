// Structural readers for thrown values, which are `unknown` under strict mode.
// They reproduce the JavaScript controllers' `error.message`, `error.name` and
// `error.code` property reads without assuming the value is an Error, so the
// JSON error responses keep their exact shape.

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

export const errorMessage = (error: unknown): unknown => (
  isObject(error) && "message" in error ? error.message : undefined
);

export const errorName = (error: unknown): unknown => (
  isObject(error) && "name" in error ? error.name : undefined
);

export const errorCode = (error: unknown): unknown => (
  isObject(error) && "code" in error ? error.code : undefined
);
