import { useCallback, useEffect, useState } from 'react';
import { useCart } from '../../contexts/CartContext';
import { useOrders } from '../../contexts/OrdersContext';
import { useProducts } from '../../contexts/ProductsContext';
import api, { getErrorMessage } from '../../services/api';

/**
 * Coordinates all data used by the admin dashboard.
 *
 * Product mutations are followed by one shared refresh so the product catalog,
 * order list, cart items, and checkout totals all reflect the same backend state.
 * The existing contexts remain the source of truth for data shared with other pages.
 */
export function useAdminDashboard(enabled) {
  const { products, loadProducts } = useProducts();
  const { orders, loadOrders } = useOrders();
  const { loadCart, loadCheckoutData } = useCart();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  /** Clears feedback before a new form or table action begins. */
  const clearMessages = useCallback(() => {
    setError('');
    setSuccess('');
  }, []);

  /**
   * Reloads every collection affected by a product mutation.
   * Running these requests together keeps the admin page and shared contexts in sync.
   */
  const refreshStoreData = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError('');

    try {
      await Promise.all([
        loadProducts(),
        loadOrders(),
        loadCart(),
        loadCheckoutData()
      ]);
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to refresh store data.'));
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [enabled, loadProducts, loadOrders, loadCart, loadCheckoutData]);

  /** Loads the initial dashboard data once administrator access is confirmed. */
  useEffect(() => {
    if (enabled) {
      refreshStoreData().catch(() => {});
    }
  }, [enabled, refreshStoreData]);

  /** Creates a product, then refreshes products, orders, and cart-related data. */
  const createProduct = useCallback(async (formData) => {
    setSaving(true);
    clearMessages();

    try {
      await api.post('/products', formData);
      await refreshStoreData();
      setSuccess('Product created successfully.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to create product.'));
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, [clearMessages, refreshStoreData]);

  /** Updates the selected product and reloads all dependent store data. */
  const updateProduct = useCallback(async (productId, formData) => {
    setSaving(true);
    clearMessages();

    try {
      await api.put(`/products/${encodeURIComponent(productId)}`, formData);
      await refreshStoreData();
      setSuccess('Product updated successfully.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to update product.'));
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, [clearMessages, refreshStoreData]);

  /**
   * Deletes a product and refreshes every dependent collection.
   * Missing cart items are retained as unavailable so customers can remove them safely.
   */
  const deleteProduct = useCallback(async (productId) => {
    setSaving(true);
    clearMessages();

    try {
      await api.delete(`/products/${encodeURIComponent(productId)}`);
      await refreshStoreData();
      setSuccess('Product deleted successfully.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to delete product.'));
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, [clearMessages, refreshStoreData]);

  return {
    products,
    orders,
    loading,
    saving,
    error,
    success,
    clearMessages,
    createProduct,
    updateProduct,
    deleteProduct,
    refreshStoreData
  };
}
