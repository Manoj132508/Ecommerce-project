import { useMemo } from 'react';
import { Header } from '../../components/Header';
import { useProductsQuery } from '../../queries/useProductsQuery';
import { getErrorMessage } from '../../services/api';
import { setSearchTerm } from '../../slices/homeSlice';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { ProductsGrid } from './ProductsGrid';

export function HomePage() {
  const dispatch = useAppDispatch();
  const searchTerm = useAppSelector((state) => state.home.searchTerm);
  const { data: products = [], error, isError, isPending } = useProductsQuery();

  const filteredProducts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return products;
    }

    return products.filter((product) => (
      [product.name, product.description, product.category, ...product.keywords]
        .some((value) => value.toLowerCase().includes(normalizedSearch))
    ));
  }, [products, searchTerm]);

  const errorMessage = isError
    ? getErrorMessage(error, 'Unable to load products. Please try again.')
    : '';

  return (
    <>
      <title>Ecommerce Project</title>

      <Header
        searchValue={searchTerm}
        onSearchChange={(value: string) => dispatch(setSearchTerm(value))}
      />

      <main className="mt-[108px] xl:mt-[60px]">
        {errorMessage && (
          <p className="p-8 text-center text-red-700" role="alert">{errorMessage}</p>
        )}

        {isPending ? (
          <p className="p-8 text-center">Loading products...</p>
        ) : filteredProducts.length > 0 ? (
          <ProductsGrid products={filteredProducts} />
        ) : !isError ? (
          <p className="p-8 text-center">No products match your search.</p>
        ) : null}
      </main>
    </>
  );
}
