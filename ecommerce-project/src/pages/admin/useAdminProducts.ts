import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cartRootKey, checkoutRootKey, ordersRootKey } from '../../queries/queryKeys';
import {
  useCreateProductMutation,
  useDeleteProductMutation,
  useUpdateProductMutation,
} from '../../queries/useProductMutations';
import { useProductsQuery } from '../../queries/useProductsQuery';
import { getErrorMessage } from '../../services/api';
import type { ProductFormData } from '../../types/product';

/** Owns product server state, mutations, and product-action feedback for Admin. */
export function useAdminProducts() {
  const queryClient = useQueryClient();
  const productsQuery = useProductsQuery();
  const {
    mutateAsync: createProductRequest,
    isPending: isCreatingProduct,
  } = useCreateProductMutation();
  const {
    mutateAsync: updateProductRequest,
    isPending: isUpdatingProduct,
  } = useUpdateProductMutation();
  const {
    mutateAsync: deleteProductRequest,
    isPending: isDeletingProduct,
  } = useDeleteProductMutation();
  const [refreshingRelatedData, setRefreshingRelatedData] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const clearMessages = useCallback(() => {
    setError('');
    setSuccess('');
  }, []);

  /** Refreshes data whose expanded product details may have changed. */
  const refreshDependentData = useCallback(async () => {
    setRefreshingRelatedData(true);

    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersRootKey }),
        queryClient.invalidateQueries({ queryKey: cartRootKey }),
        queryClient.invalidateQueries({ queryKey: checkoutRootKey }),
      ]);
    } finally {
      setRefreshingRelatedData(false);
    }
  }, [queryClient]);   

  /** Runs one product mutation and synchronizes all product-dependent data. */
  const runProductAction = useCallback(async (
    request: () => Promise<unknown>,
    successMessage: string,
    fallbackError: string,
  ) => {
    clearMessages();

    try {
      await request();
      await refreshDependentData();
      setSuccess(successMessage);
    } catch (requestError) {
      setError(getErrorMessage(requestError, fallbackError));
      throw requestError;
    }
  }, [clearMessages, refreshDependentData]);

  const createProduct = useCallback((formData: ProductFormData) => (
    runProductAction(
      () => createProductRequest(formData),
      'Product created successfully.',
      'Unable to create product.',
    )
  ), [createProductRequest, runProductAction]);

  const updateProduct = useCallback((productId: string, formData: ProductFormData) => (
    runProductAction(
      () => updateProductRequest({ productId, formData }),
      'Product updated successfully.',
      'Unable to update product.',
    )
  ), [runProductAction, updateProductRequest]);

  const deleteProduct = useCallback((productId: string) => (
    runProductAction(
      () => deleteProductRequest(productId),
      'Product deleted successfully.',
      'Unable to delete product.',
    )
  ), [deleteProductRequest, runProductAction]);

  const productQueryError = productsQuery.isError
    ? getErrorMessage(productsQuery.error, 'Unable to load products. Please try again.')
    : '';

  return {
    products: productsQuery.data ?? [],
    loading: productsQuery.isPending,
    saving: isCreatingProduct
      || isUpdatingProduct
      || isDeletingProduct
      || refreshingRelatedData,
    error: error || productQueryError,
    success,
    clearMessages,
    createProduct,
    updateProduct,
    deleteProduct,
  };
}
