import { useEffect } from 'react';
import { Header } from '../../components/Header';
import { useProducts } from '../../contexts/ProductsContext';
import { ProductsGrid } from './ProductsGrid';

export function HomePage() {
  const { products, loading, error, loadProducts } = useProducts();

  useEffect(() => {
    loadProducts().catch(() => {});
  }, [loadProducts]);

  return (
    <>
      <title>Ecommerce Project</title>

      <Header />

      <main className="mt-[108px] xl:mt-[60px]">
        {error && (
          <p className="p-8 text-center text-red-700" role="alert">{error}</p>
        )}
        {loading && products.length === 0 ? (
          <p className="p-8 text-center">Loading products...</p>
        ) : (
          <ProductsGrid products={products} />
        )}
      </main>
    </>
  );
}
