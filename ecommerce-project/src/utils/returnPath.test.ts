import { describe, expect, test } from 'vitest';
import { safeReturnPath } from './returnPath';

describe('safeReturnPath', () => {
  test.each([
    ['/checkout', '/checkout'],
    ['/products/e43638ce-6aa0-4b85-b27f-e1d07eb678c6', '/products/e43638ce-6aa0-4b85-b27f-e1d07eb678c6'],
    ['/tracking?orderId=1&productId=2', '/tracking?orderId=1&productId=2'],
    ['/', '/'],
  ])('keeps the in-app path %j', (value, expected) => {
    expect(safeReturnPath(value)).toBe(expected);
  });

  test.each([
    ['//evil.example', 'protocol-relative URL'],
    ['/\\evil.example', 'backslash trick'],
    ['https://evil.example/checkout', 'absolute URL'],
    ['javascript:alert(1)', 'script URL'],
    ['checkout', 'relative path'],
    ['/check\nout', 'control character'],
    ['/login', 'login page (would loop)'],
    ['/register?x=1', 'register page (would loop)'],
    ['', 'empty string'],
    [`/${'a'.repeat(3000)}`, 'oversized path'],
  ])('rejects %j (%s)', (value) => {
    expect(safeReturnPath(value)).toBe('/');
  });

  test.each([null, undefined, 42, { pathname: '/checkout' }, ['/checkout']])('rejects the non-string %j', (value) => {
    expect(safeReturnPath(value)).toBe('/');
  });

  test('uses the given fallback', () => {
    expect(safeReturnPath('//evil.example', '/orders')).toBe('/orders');
  });
});
