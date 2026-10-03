import { AuthProvider } from './AuthContext';
import { CartProvider } from './CartContext';
import { OrdersProvider } from './OrdersContext';
import { ProductsProvider } from './ProductsContext';

export function AppProviders({ children }) {
  return (
    <AuthProvider>
      <ProductsProvider>
        <CartProvider>
          <OrdersProvider>{children}</OrdersProvider>
        </CartProvider>
      </ProductsProvider>
    </AuthProvider>
  );
}
