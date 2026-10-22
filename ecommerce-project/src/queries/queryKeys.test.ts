import { describe, expect, test } from 'vitest';
import {
  ANONYMOUS,
  authQueryKey,
  cartQueryKey,
  checkoutQueryKey,
  isAuthMutationKey,
  isUserScopedKey,
  loginMutationKey,
  orderQueryKey,
  ordersQueryKey,
  productsQueryKey,
  registerMutationKey,
} from './queryKeys';

describe('query keys', () => {
  test('user-specific data is keyed by user, so two users never share a cache entry', () => {
    expect(cartQueryKey('alice')).toEqual(['cart', 'alice']);
    expect(cartQueryKey('alice')).not.toEqual(cartQueryKey('bob'));
    expect(checkoutQueryKey('alice')).not.toEqual(checkoutQueryKey('bob'));
    expect(ordersQueryKey('alice')).not.toEqual(ordersQueryKey('bob'));
    expect(orderQueryKey('alice', 'order-1')).not.toEqual(orderQueryKey('bob', 'order-1'));
  });

  test('signed-out data uses the anonymous scope (the legacy shared cart)', () => {
    expect(cartQueryKey(null)).toEqual(['cart', ANONYMOUS]);
    expect(ordersQueryKey(null)).toEqual(['orders', ANONYMOUS]);
  });

  test('identifies user-scoped keys for clearing on logout', () => {
    for (const key of [cartQueryKey('a'), checkoutQueryKey(null), ordersQueryKey('a'), orderQueryKey('a', 'o')]) {
      expect(isUserScopedKey(key)).toBe(true);
    }
    expect(isUserScopedKey(productsQueryKey)).toBe(false);
    expect(isUserScopedKey(authQueryKey)).toBe(false);
  });

  test('identifies login and register mutations (their 401 is not an expired session)', () => {
    expect(isAuthMutationKey(loginMutationKey)).toBe(true);
    expect(isAuthMutationKey(registerMutationKey)).toBe(true);
    expect(isAuthMutationKey(['cart', 'add'])).toBe(false);
    expect(isAuthMutationKey(undefined)).toBe(false);
  });
});
