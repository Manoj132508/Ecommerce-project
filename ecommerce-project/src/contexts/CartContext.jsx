import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { getErrorMessage } from '../services/api';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deliveryOptions, setDeliveryOptions] = useState([]);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const cartRequestVersion = useRef(0);
  const checkoutRequestVersion = useRef(0);

  const clearError = useCallback(() => setError(null), []);

  const loadCart = useCallback(async () => {
    const version = ++cartRequestVersion.current;
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.get('/cart-items?expand=product');
      if (version === cartRequestVersion.current) {
        setCart(data);
      }
      return data;
    } catch (requestError) {
      if (version === cartRequestVersion.current) {
        setError(getErrorMessage(requestError, 'Unable to load your cart. Please try again.'));
      }
      throw requestError;
    } finally {
      if (version === cartRequestVersion.current) {
        setLoading(false);
      }
    }
  }, []);

  const mutateCart = useCallback(async (method, endpoint, data) => {
    setError(null);

    try {
      const response = await api.request({ method, url: endpoint, data });
       console.log('Cart updated successfully:', response.data);
      await loadCart();
       console.log('Cart updated successfully:', response.data);
     
      return response.data;
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to update your cart. Please try again.'));
      throw requestError;
    }
  }, [loadCart]);

  const addToCart = useCallback((productId, quantity = 1) => {
    return mutateCart('post', '/cart-items', { productId, quantity });
  }, [mutateCart]);

  const updateCartItem = useCallback((productId, updates) => {
    return mutateCart('put', `/cart-items/${encodeURIComponent(productId)}`, updates);
  }, [mutateCart]);

  const removeFromCart = useCallback((productId) => {
    return mutateCart('delete', `/cart-items/${encodeURIComponent(productId)}`);
  }, [mutateCart]);

  const loadCheckoutData = useCallback(async () => {
    const version = ++checkoutRequestVersion.current;
    setCheckoutLoading(true);
    setError(null);

    try {
      const [deliveryResponse, summaryResponse] = await Promise.all([
        api.get('/delivery-options?expand=estimatedDeliveryTime'),
        api.get('/payment-summary')
      ]);

      if (version === checkoutRequestVersion.current) {
        setDeliveryOptions(deliveryResponse.data);
        setPaymentSummary(summaryResponse.data);
      }

      return { deliveryOptions: deliveryResponse.data, paymentSummary: summaryResponse.data };
    } catch (requestError) {
      if (version === checkoutRequestVersion.current) {
        setPaymentSummary(null);
        setError(getErrorMessage(requestError, 'Unable to load checkout details. Please try again.'));
      }
      throw requestError;
    } finally {
      if (version === checkoutRequestVersion.current) {
        setCheckoutLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadCart().catch(() => {});

    return () => {
      cartRequestVersion.current += 1;
      checkoutRequestVersion.current += 1;
    };
  }, [loadCart]);

  const totalQuantity = cart.reduce((total, item) => total + item.quantity, 0);
  const value = useMemo(() => ({
    cart, loading, error, totalQuantity, loadCart, addToCart, updateCartItem, removeFromCart,
    deliveryOptions, paymentSummary, checkoutLoading, loadCheckoutData, clearError
  }), [cart, loading, error, totalQuantity, loadCart, addToCart, updateCartItem, removeFromCart,
    deliveryOptions, paymentSummary, checkoutLoading, loadCheckoutData, clearError]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within CartProvider');
  }
  return context;
}
