// In-memory stand-in for the backend API, following its contract (status
// codes and messages as in the backend tests). cartMode selects the legacy
// shared MongoDB cart ("shared", no login) or PostgreSQL per-user carts
// ("per-user": login required, integer quantities 1-10).
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';

export type CartMode = 'shared' | 'per-user';

interface FakeUser { _id: string; name: string; email: string; isAdmin: boolean; password: string; token: string }
interface FakeLine { productId: string; quantity: number; deliveryOptionId: string; id: string; createdAt: string; updatedAt: string }
interface FakeOrder { id: string; userId: string; orderTimeMs: number; totalCostCents: number; products: { productId: string; product: ReturnType<typeof product> | null; quantity: number; estimatedDeliveryTimeMs: number }[] }

export const SOCKS = 'e43638ce-6aa0-4b85-b27f-e1d07eb678c6';
export const BALL = '15b6fc6f-327a-4ec4-896f-486349e85a3d';
export const PASSWORD = 'user-password-123';

const product = (id: string, name: string, priceCents: number) => ({
  id, name, priceCents, image: `images/products/${name.toLowerCase()}.jpg`, description: `${name} description`,
  howItWorks: 'Use it.', highlights: ['Useful'], careInstructions: 'Keep clean.', category: 'General', stock: 0,
  rating: { stars: 4.5, count: 10 }, keywords: [name.toLowerCase()],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

export function createFakeState(cartMode: CartMode) {
  const users: FakeUser[] = [
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', name: 'Alice', email: 'alice@example.com', isAdmin: false, password: PASSWORD, token: 'token-alice' },
    { _id: 'bbbbbbbbbbbbbbbbbbbbbbb2', name: 'Bob', email: 'bob@example.com', isAdmin: false, password: PASSWORD, token: 'token-bob' },
  ];
  return {
    cartMode,
    users,
    products: [product(SOCKS, 'Socks', 1090), product(BALL, 'Basketball', 2095)],
    deletedProductIds: new Set<string>(),
    carts: new Map<string, FakeLine[]>(),
    orders: new Map<string, FakeOrder[]>(),
    /** Forces the next POST /api/orders to fail with this response. */
    nextOrderError: null as null | { status: number; body: object },
    /** Forces the next cart update (PUT) to fail with this response. */
    nextCartError: null as null | { status: number; body: object },
    requests: [] as { method: string; path: string; authorization: string | null }[],
  };
}

export type FakeState = ReturnType<typeof createFakeState>;

let state = createFakeState('shared');

export const server = setupServer();

const json = (body: JsonBodyType, status = 200) => HttpResponse.json(body, { status });
const notAuthorized = () => json({ message: 'Not authorized' }, 401);
const quantityError = () => json({ message: 'Quantity must be between 1 and 10' }, 400);

function userFor(request: Request): FakeUser | null {
  const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  return state.users.find((user) => user.token === token) ?? null;
}

/** Shared mode: one cart for everyone. Per-user mode: the caller's cart, or null (401). */
function cartFor(request: Request): FakeLine[] | null {
  if (state.cartMode === 'shared') {
    if (!state.carts.has('shared')) state.carts.set('shared', []);
    return state.carts.get('shared') ?? null;
  }
  const user = userFor(request);
  if (!user) return null;
  if (!state.carts.has(user._id)) state.carts.set(user._id, []);
  return state.carts.get(user._id) ?? null;
}

const liveProduct = (id: string) => (state.deletedProductIds.has(id) ? null : state.products.find((item) => item.id === id) ?? null);

const validQuantity = (value: unknown) => (
  state.cartMode === 'per-user'
    ? typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10
    : typeof value === 'number' && value >= 1 && value <= 10
);

const handlers = [
  http.all('*/api/*', ({ request }) => {
    state.requests.push({ method: request.method, path: new URL(request.url).pathname, authorization: request.headers.get('Authorization') });
    return undefined;
  }),

  http.get('*/api/auth/profile', ({ request }) => {
    const user = userFor(request);
    if (!user) return notAuthorized();
    const { _id, name, email, isAdmin } = user;
    return json({ _id, name, email, isAdmin });
  }),

  http.post('*/api/auth/login', async ({ request }) => {
    const body = await request.json();
    const credentials = typeof body === 'object' && body !== null ? body : {};
    const user = state.users.find((candidate) => (
      'email' in credentials && 'password' in credentials
      && candidate.email === credentials.email && candidate.password === credentials.password
    ));
    if (!user) return json({ message: 'Invalid email or password' }, 401);
    const { _id, name, email, isAdmin, token } = user;
    return json({ _id, name, email, isAdmin, token });
  }),

  http.get('*/api/products', () => json(state.products.filter((item) => !state.deletedProductIds.has(item.id)))),

  http.get('*/api/delivery-options', () => json([
    { id: '1', deliveryDays: 7, priceCents: 0, estimatedDeliveryTimeMs: Date.now() + 7 * 86_400_000, createdAt: '', updatedAt: '' },
    { id: '3', deliveryDays: 1, priceCents: 999, estimatedDeliveryTimeMs: Date.now() + 86_400_000, createdAt: '', updatedAt: '' },
  ])),

  http.get('*/api/cart-items', ({ request }) => {
    const cart = cartFor(request);
    if (!cart) return notAuthorized();
    return json(cart.map((line) => {
      const current = liveProduct(line.productId);
      return { ...line, product: current, unavailable: !current };
    }));
  }),

  http.post('*/api/cart-items', async ({ request }) => {
    const cart = cartFor(request);
    if (!cart) return notAuthorized();
    const body = await request.json();
    const { productId, quantity } = typeof body === 'object' && body !== null && 'productId' in body && 'quantity' in body
      ? body : { productId: undefined, quantity: undefined };
    if (!validQuantity(quantity) || typeof quantity !== 'number') return quantityError();
    if (typeof productId !== 'string' || !liveProduct(productId)) return json({ message: 'Product not found' }, 404);

    const existing = cart.find((line) => line.productId === productId);
    if (existing) {
      if (state.cartMode === 'per-user' && existing.quantity + quantity > 10) return quantityError();
      existing.quantity += quantity;
      return json(existing, 201);
    }
    const line = { productId, quantity, deliveryOptionId: '1', id: `line-${cart.length + 1}`, createdAt: '', updatedAt: '' };
    cart.push(line);
    return json(line, 201);
  }),

  http.put('*/api/cart-items/:productId', async ({ request, params }) => {
    const cart = cartFor(request);
    if (!cart) return notAuthorized();
    const line = cart.find((item) => item.productId === params.productId);
    if (!line) return json({ message: 'Cart item not found' }, 404);
    if (state.nextCartError) {
      const { status, body } = state.nextCartError;
      state.nextCartError = null;
      return json(body, status);
    }
    const body = await request.json();
    if (typeof body === 'object' && body !== null && 'quantity' in body) {
      if (!validQuantity(body.quantity) || typeof body.quantity !== 'number') return quantityError();
      line.quantity = body.quantity;
    }
    return json(line);
  }),

  http.delete('*/api/cart-items/:productId', ({ request, params }) => {
    const cart = cartFor(request);
    if (!cart) return notAuthorized();
    const index = cart.findIndex((item) => item.productId === params.productId);
    if (index < 0) return json({ message: 'Cart item not found' }, 404);
    cart.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('*/api/payment-summary', ({ request }) => {
    const cart = cartFor(request);
    if (!cart) return notAuthorized();
    const available = cart.filter((line) => liveProduct(line.productId));
    const productCostCents = available.reduce((total, line) => total + (liveProduct(line.productId)?.priceCents ?? 0) * line.quantity, 0);
    const taxCents = Math.round(productCostCents * 0.1);
    return json({
      totalItems: available.reduce((total, line) => total + line.quantity, 0),
      productCostCents, shippingCostCents: 0, totalCostBeforeTaxCents: productCostCents, taxCents,
      totalCostCents: productCostCents + taxCents,
      unavailableProductIds: cart.filter((line) => !liveProduct(line.productId)).map((line) => line.productId),
    });
  }),

  http.get('*/api/orders', ({ request }) => {
    const user = userFor(request);
    if (!user) return notAuthorized();
    return json(state.orders.get(user._id) ?? []);
  }),

  http.post('*/api/orders', ({ request }) => {
    const user = userFor(request);
    if (!user) return notAuthorized();
    if (state.nextOrderError) {
      const { status, body } = state.nextOrderError;
      state.nextOrderError = null;
      return json(body, status);
    }
    const cart = cartFor(request) ?? [];
    if (cart.length === 0) return json({ message: 'Cart is empty' }, 400);
    const order: FakeOrder = {
      id: `order-${(state.orders.get(user._id)?.length ?? 0) + 1}`, userId: user._id, orderTimeMs: Date.now(), totalCostCents: 1,
      products: cart.map((line) => ({ productId: line.productId, product: liveProduct(line.productId), quantity: line.quantity, estimatedDeliveryTimeMs: Date.now() })),
    };
    state.orders.set(user._id, [...(state.orders.get(user._id) ?? []), order]);
    cart.splice(0, cart.length);
    return json(order, 201);
  }),
];

/** Installs a fresh fake backend in the given cart mode and returns its state. */
export function installFakeApi(cartMode: CartMode): FakeState {
  state = createFakeState(cartMode);
  server.use(...handlers);
  return state;
}
