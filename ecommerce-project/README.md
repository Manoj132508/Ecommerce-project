# Ecommerce frontend

Run `npm install`, then `npm run dev`. During development, Vite forwards `/api`
requests to the backend at `http://localhost:3000`.

To use a different API server, create `.env.local` and set:

```text
VITE_API_URL=https://example.com/api
```

## Where data lives

Server requests are kept out of page components:

| File | Responsibility |
| --- | --- |
| `src/services/api.js` | Axios base URL, readable errors, token storage, and the bearer-token interceptor |
| `src/contexts/AuthContext.jsx` | Registration, login, logout, profile restoration, and the current user |
| `src/contexts/CartContext.jsx` | Cart operations, delivery options, and the payment summary |
| `src/contexts/ProductsContext.jsx` | Product loading and product state |
| `src/contexts/OrdersContext.jsx` | Order lists, order details, and order creation |
| `src/contexts/AppProviders.jsx` | Composes all providers in one place |

Pages use the matching hook instead of receiving shared data through several
layers of props:

```jsx
import { useCart } from '../../contexts/CartContext';

const { cart, addToCart } = useCart();
```

Authentication forms can use `useAuth()`:

```jsx
const { login, loading, error } = useAuth();
const result = await login(email, password);

if (result.success) {
  // Continue to the signed-in area.
}
```

Keep temporary display state in the component that owns it. Examples include a
selected quantity, a loading button, and the two-second “Added” message. Put
state in a context when several unrelated components need the same server data.
