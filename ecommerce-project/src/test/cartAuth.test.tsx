// Interaction tests for authentication and the cart, against the fake API in
// both cart modes: the legacy shared MongoDB cart ("shared") and PostgreSQL
// per-user carts ("per-user", login required).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { cartQueryKey } from '../queries/queryKeys';
import { BALL, installFakeApi, PASSWORD, SOCKS } from './fakeApi';
import { renderApp } from './renderApp';

const ALICE_ID = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const location = () => screen.getByTestId('location').textContent;
const productCard = async (name: string) => {
  const card = (await screen.findByRole('link', { name })).closest('article');
  if (!card) throw new Error(`No product card for ${name}`);
  return within(card);
};

async function logIn(user: ReturnType<typeof renderApp>['user'], email: string) {
  await user.type(await screen.findByLabelText('Email Address'), email);
  await user.type(screen.getByLabelText('Password'), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Login' }));
}

describe('adding to the cart', () => {
  test('signed out: opens the login flow and returns to the same page afterwards', async () => {
    const api = installFakeApi('per-user');
    const { user } = renderApp({ path: '/' });

    await user.click((await productCard('Socks')).getByRole('button', { name: 'Add to Cart' }));

    expect(location()).toBe('/login');
    expect(await screen.findByRole('status')).toHaveTextContent('Log in to add items to your cart.');
    await logIn(user, 'alice@example.com');
    await waitFor(() => expect(location()).toBe('/'));
    // Nothing is added on the user's behalf: no cart write happened.
    expect(api.requests.filter((request) => request.method === 'POST' && request.path === '/api/cart-items')).toEqual([]);
  });

  test('signed in: adds with the bearer token and the header count follows', async () => {
    const api = installFakeApi('per-user');
    const { user } = renderApp({ path: '/', token: 'token-alice' });

    await screen.findByText('Alice');
    await user.selectOptions((await productCard('Socks')).getByRole('combobox'), '2');
    await user.click((await productCard('Socks')).getByRole('button', { name: 'Add to Cart' }));

    expect(await screen.findByLabelText('Cart with 2 items')).toBeInTheDocument();
    expect(api.requests.find((request) => request.method === 'POST')?.authorization).toBe('Bearer token-alice');
  });

  test('shows the quantity limit error from the server (FD1)', async () => {
    const api = installFakeApi('per-user');
    api.carts.set(ALICE_ID, [{ productId: SOCKS, quantity: 9, deliveryOptionId: '1', id: 'l1', createdAt: '', updatedAt: '' }]);
    const { user } = renderApp({ path: '/', token: 'token-alice' });

    await screen.findByText('Alice');
    await user.selectOptions((await productCard('Socks')).getByRole('combobox'), '2');
    await user.click((await productCard('Socks')).getByRole('button', { name: 'Add to Cart' }));

    expect(await (await productCard('Socks')).findByRole('alert')).toHaveTextContent('Quantity must be between 1 and 10');
    expect(api.carts.get(ALICE_ID)?.[0]?.quantity).toBe(9);
  });
});

describe('checkout page access', () => {
  test('legacy shared MongoDB cart: unchanged, an anonymous visitor still sees the cart', async () => {
    const api = installFakeApi('shared');
    api.carts.set('shared', [{ productId: SOCKS, quantity: 1, deliveryOptionId: '1', id: 'l1', createdAt: '', updatedAt: '' }]);
    renderApp({ path: '/checkout' });

    expect(await screen.findByText('Socks')).toBeInTheDocument();
    expect(location()).toBe('/checkout');
  });

  test('per-user carts: 401 opens the login flow, then returns to checkout with the right cart', async () => {
    const api = installFakeApi('per-user');
    api.carts.set(ALICE_ID, [{ productId: BALL, quantity: 1, deliveryOptionId: '1', id: 'l1', createdAt: '', updatedAt: '' }]);
    const { user } = renderApp({ path: '/checkout' });

    await waitFor(() => expect(location()).toBe('/login'));
    expect(await screen.findByRole('status')).toHaveTextContent('Please log in to continue.');

    await logIn(user, 'alice@example.com');
    await waitFor(() => expect(location()).toBe('/checkout'));
    expect(await screen.findByText('Basketball')).toBeInTheDocument();
  });

  test('an expired session is cleared and explained, and login returns to checkout', async () => {
    installFakeApi('per-user');
    const { user } = renderApp({ path: '/checkout', token: 'token-that-expired' });

    await waitFor(() => expect(location()).toBe('/login'));
    expect(await screen.findByRole('status')).toHaveTextContent('Your session has expired. Please log in again.');
    expect(localStorage.getItem('token')).toBeNull();

    await logIn(user, 'alice@example.com');
    await waitFor(() => expect(location()).toBe('/checkout'));
  });

  test('orders also require login', async () => {
    installFakeApi('per-user');
    renderApp({ path: '/orders' });
    await waitFor(() => expect(location()).toBe('/login'));
  });
});

describe('isolation between users', () => {
  test('after logout, the next user never sees the previous cart', async () => {
    const api = installFakeApi('per-user');
    api.carts.set(ALICE_ID, [{ productId: SOCKS, quantity: 3, deliveryOptionId: '1', id: 'l1', createdAt: '', updatedAt: '' }]);
    api.carts.set('bbbbbbbbbbbbbbbbbbbbbbb2', [{ productId: BALL, quantity: 1, deliveryOptionId: '1', id: 'l2', createdAt: '', updatedAt: '' }]);
    const { user, queryClient } = renderApp({ path: '/checkout', token: 'token-alice' });

    expect(await screen.findByText('Socks')).toBeInTheDocument();
    expect(queryClient.getQueryData(cartQueryKey(ALICE_ID))).toBeDefined();

    await user.click(screen.getByRole('link', { name: /Ecommerce-Project/ }));
    await user.click(await screen.findByRole('button', { name: 'Logout' }));
    expect(location()).toBe('/login');
    // No cart data survives logout: Alice's entry is gone, and any remaining
    // cart entry is the signed-out header's disabled query, holding no data.
    expect(queryClient.getQueryCache().findAll({ queryKey: cartQueryKey(ALICE_ID) })).toEqual([]);
    expect(queryClient.getQueryCache().findAll({ queryKey: ['cart'] }).map((query) => query.state.data)).toEqual(
      queryClient.getQueryCache().findAll({ queryKey: ['cart'] }).map(() => undefined),
    );
    expect(localStorage.getItem('token')).toBeNull();

    await logIn(user, 'bob@example.com');
    await waitFor(() => expect(location()).toBe('/'));
    await user.click(await screen.findByRole('link', { name: 'Cart with 1 items' }));
    expect(await screen.findByText('Basketball')).toBeInTheDocument();
    expect(screen.queryByText('Socks')).not.toBeInTheDocument();
  });

  test('a sign-out in another tab clears this tab’s user data', async () => {
    installFakeApi('per-user');
    const { queryClient } = renderApp({ path: '/checkout', token: 'token-alice' });
    await waitFor(() => expect(queryClient.getQueryCache().findAll({ queryKey: ['cart'] }).length).toBeGreaterThan(0));

    localStorage.removeItem('token');
    window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: null }));

    await waitFor(() => expect(queryClient.getQueryCache().findAll({ queryKey: ['cart', ALICE_ID] })).toEqual([]));
  });
});

describe('return destinations', () => {
  test.each(['//evil.example', 'https://evil.example', '/login'])('an unsafe "from" (%s) falls back to the home page', async (from) => {
    installFakeApi('per-user');
    const { user } = renderApp({ path: { pathname: '/login', state: { from } } });
    await logIn(user, 'alice@example.com');
    await waitFor(() => expect(location()).toBe('/'));
  });
});

describe('checkout outcomes', () => {
  const ALICE_CART = [{ productId: SOCKS, quantity: 1, deliveryOptionId: '1', id: 'l1', createdAt: '', updatedAt: '' }];

  async function placeOrder(nextOrderError: { status: number; body: object } | null) {
    const api = installFakeApi('per-user');
    api.carts.set(ALICE_ID, [...ALICE_CART]);
    api.nextOrderError = nextOrderError;
    const result = renderApp({ path: '/order-confirmation', token: 'token-alice' });
    for (const [label, value] of [['Phone', '0123'], ['Country', 'UK'], ['Address', '1 Way'], ['City', 'London'], ['Postal code', 'N1']]) {
      await result.user.type(await screen.findByLabelText(label), value);
    }
    await result.user.click(await screen.findByRole('button', { name: 'Confirm and place order' }));
    return { ...result, api };
  }

  test('success places the order and opens the orders page', async () => {
    const { api } = await placeOrder(null);
    await waitFor(() => expect(location()).toBe('/orders'));
    expect(api.carts.get(ALICE_ID)).toEqual([]);
  });

  test('409 unavailable products: shows the server message and refreshes the cart', async () => {
    const { api } = await placeOrder({ status: 409, body: { message: 'Remove unavailable products from your cart before placing the order', unavailableProductIds: [SOCKS] } });
    expect(await screen.findByText('Remove unavailable products from your cart before placing the order')).toBeInTheDocument();
    await waitFor(() => expect(api.requests.filter((request) => request.path === '/api/cart-items').length).toBeGreaterThan(1));
    expect(location()).toBe('/order-confirmation');
  });

  test('409 insufficient stock: shows the server message', async () => {
    await placeOrder({ status: 409, body: { message: 'Some products do not have enough stock for this order', insufficientStockProductIds: [SOCKS] } });
    expect(await screen.findByText('Some products do not have enough stock for this order')).toBeInTheDocument();
  });

  test('400 empty cart: shows the server message', async () => {
    await placeOrder({ status: 400, body: { message: 'Cart is empty' } });
    expect(await screen.findByText('Cart is empty')).toBeInTheDocument();
  });
});

describe('editing quantities at checkout', () => {
  test('a valid change is saved', async () => {
    const api = installFakeApi('per-user');
    api.carts.set(ALICE_ID, [{ productId: SOCKS, quantity: 2, deliveryOptionId: '1', id: 'l1', createdAt: '', updatedAt: '' }]);
    const { user } = renderApp({ path: '/checkout', token: 'token-alice' });

    await user.click(await screen.findByRole('button', { name: 'Update' }));
    await user.selectOptions(screen.getByRole('combobox', { name: /Quantity/ }), '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.carts.get(ALICE_ID)?.[0]?.quantity).toBe(10));
  });

  test('a rejected change shows the server error and keeps the line as it was', async () => {
    const api = installFakeApi('per-user');
    api.carts.set(ALICE_ID, [{ productId: SOCKS, quantity: 2, deliveryOptionId: '1', id: 'l1', createdAt: '', updatedAt: '' }]);
    api.nextCartError = { status: 400, body: { message: 'Quantity must be between 1 and 10' } };
    const { user } = renderApp({ path: '/checkout', token: 'token-alice' });

    await user.click(await screen.findByRole('button', { name: 'Update' }));
    await user.selectOptions(screen.getByRole('combobox', { name: /Quantity/ }), '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Quantity must be between 1 and 10')).toBeInTheDocument();
    expect(api.carts.get(ALICE_ID)?.[0]?.quantity).toBe(2);
  });
});
