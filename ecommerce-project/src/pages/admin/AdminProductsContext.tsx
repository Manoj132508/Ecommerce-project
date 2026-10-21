import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { ProductData, ProductFormData } from '../../types/product';
import { useAdminProducts } from './useAdminProducts';

type AdminProductsContextValue = ReturnType<typeof useAdminProducts> & {
  editingProduct: ProductData | null;
  startEditing: (product: ProductData) => void;
  cancelEditing: () => void;
  updateProduct: (productId: string, formData: ProductFormData) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
};

const AdminProductsContext = createContext<AdminProductsContextValue | null>(null);

/** Provides product data, actions, and edit selection only to the Admin Products feature. */
export function AdminProductsProvider({ children }: PropsWithChildren) {
  const {
    products,
    loading,
    saving,
    error,
    success,
    clearMessages,
    createProduct,
    updateProduct: updateProductRequest,
    deleteProduct: deleteProductRequest,
  } = useAdminProducts();
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const editingProduct = useMemo(() => (
    products.find((product) => product.id === editingProductId) ?? null
  ), [editingProductId, products]);

  const startEditing = useCallback((product: ProductData) => {
    clearMessages();
    setEditingProductId(product.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [clearMessages]);

  const cancelEditing = useCallback(() => {
    clearMessages();
    setEditingProductId(null);
  }, [clearMessages]);

  const updateProduct = useCallback(async (productId: string, formData: ProductFormData) => {
    await updateProductRequest(productId, formData);
    setEditingProductId(null);
  }, [updateProductRequest]);

  const deleteProduct = useCallback(async (productId: string) => {
    await deleteProductRequest(productId);
    setEditingProductId((currentProductId) => (
      currentProductId === productId ? null : currentProductId
    ));
  }, [deleteProductRequest]);

  const value = useMemo<AdminProductsContextValue>(() => ({
    products,
    loading,
    saving,
    error,
    success,
    clearMessages,
    createProduct,
    editingProduct,
    startEditing,
    cancelEditing,
    updateProduct,
    deleteProduct,
  }), [
    products,
    loading,
    saving,
    error,
    success,
    clearMessages,
    createProduct,
    editingProduct,
    startEditing,
    cancelEditing,
    updateProduct,
    deleteProduct,
  ]);

  return (
    <AdminProductsContext.Provider value={value}>
      {children}
    </AdminProductsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAdminProductsContext() {
  const context = useContext(AdminProductsContext);

  if (!context) {
    throw new Error('useAdminProductsContext must be used within AdminProductsProvider');
  }

  return context;
}
