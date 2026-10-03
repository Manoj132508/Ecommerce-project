import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import api, { getErrorMessage } from '../services/api';

const ProductsContext = createContext(null);

export function ProductsProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestVersion = useRef(0);

  const clearError = useCallback(() => setError(null), []);

  const loadProducts = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.get('/products');
      if (version === requestVersion.current) {
        setProducts(data);
      }
      return data;
    } catch (requestError) {
      if (version === requestVersion.current) {
        setError(getErrorMessage(requestError, 'Unable to load products. Please try again.'));
      }
      throw requestError;
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, []);

  const value = useMemo(() => ({
    products, loading, error, loadProducts, clearError
  }), [products, loading, error, loadProducts, clearError]);

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProducts() {
  const context = useContext(ProductsContext);
  if (!context) {
    throw new Error('useProducts must be used within ProductsProvider');
  }
  return context;
}
