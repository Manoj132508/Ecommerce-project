import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { ProductData, ProductFormData } from '../types/product';
import { productsQueryKey } from './useProductsQuery';

interface UpdateProductVariables {
  productId: string;
  formData: ProductFormData;
}

interface DeleteProductResponse {
  id: string;
}

async function createProduct(formData: ProductFormData): Promise<ProductData> {
  const { data } = await api.post('/products', formData);
  return data as ProductData;
}

async function updateProduct({ productId, formData }: UpdateProductVariables): Promise<ProductData> {
  const { data } = await api.put(`/products/${encodeURIComponent(productId)}`, formData);
  return data as ProductData;
}

async function deleteProduct(productId: string): Promise<DeleteProductResponse> {
  const { data } = await api.delete(`/products/${encodeURIComponent(productId)}`);
  return data as DeleteProductResponse;
}

export function useCreateProductMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productsQueryKey }),
  });
}

export function useUpdateProductMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productsQueryKey }),
  });
}

export function useDeleteProductMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productsQueryKey }),
  });
}
