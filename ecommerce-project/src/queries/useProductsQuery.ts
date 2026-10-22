import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { ProductData } from '../types/product';

import { productsQueryKey } from './queryKeys';

export { productsQueryKey };

async function fetchProducts(): Promise<ProductData[]> {
  const { data } = await api.get('/products');

  if (!Array.isArray(data)) {
    throw new Error('The products response is not a list.');
  }

  return data as ProductData[];
}

export function useProductsQuery(enabled = true) {
  return useQuery({
    queryKey: productsQueryKey,
    queryFn: fetchProducts,
    enabled,
  });
}
