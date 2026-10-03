import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import api, { getErrorMessage } from '../services/api';
import { useCart } from './CartContext';

const OrdersContext = createContext(null);

export function OrdersProvider({ children }) {
  const { loadCart } = useCart();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const listRequestVersion = useRef(0);
  const pendingRequests = useRef(0);

  const clearError = useCallback(() => setError(null), []);

  const beginRequest = useCallback(() => {
    pendingRequests.current += 1;
    setLoading(true);
    setError(null);
  }, []);

  const endRequest = useCallback(() => {
    pendingRequests.current -= 1;
    setLoading(pendingRequests.current > 0);
  }, []);

  const loadOrders = useCallback(async () => {
    const version = ++listRequestVersion.current;
    beginRequest();

    try {
      const { data } = await api.get('/orders?expand=products');
      if (version === listRequestVersion.current) {
        setOrders(data);
      }
      return data;
    } catch (requestError) {
      if (version === listRequestVersion.current) {
        setError(getErrorMessage(requestError, 'Unable to load orders. Please try again.'));
      }
      throw requestError;
    } finally {
      endRequest();
    }
  }, [beginRequest, endRequest]);

  const loadOrder = useCallback(async (orderId) => {
    beginRequest();

    try {
      const { data } = await api.get(`/orders/${encodeURIComponent(orderId)}?expand=products`);
      return data;
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to load this order. Please try again.'));
      throw requestError;
    } finally {
      endRequest();
    }
  }, [beginRequest, endRequest]);

  const createOrder = useCallback(async (customer) => {
    beginRequest();

    try {
      const { data } = await api.post('/orders', { customer });
      // The order response may omit expanded products; the orders page reloads the list.
      listRequestVersion.current += 1;
      setOrders([]);
      await loadCart();
      return data;
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to place your order. Please try again.'));
      throw requestError;
    } finally {
      endRequest();
    }
  }, [beginRequest, endRequest, loadCart]);

  const value = useMemo(() => ({
    orders, loading, error, loadOrders, loadOrder, createOrder, clearError
  }), [orders, loading, error, loadOrders, loadOrder, createOrder, clearError]);

  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrders() {
  const context = useContext(OrdersContext);
  if (!context) {
    throw new Error('useOrders must be used within OrdersProvider');
  }
  return context;
}
