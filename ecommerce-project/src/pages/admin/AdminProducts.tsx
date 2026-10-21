import { AdminProductsProvider, useAdminProductsContext } from './AdminProductsContext';
import { ProductForm } from './ProductForm';
import { ProductsTable } from './ProductsTable';

function AdminProductsContent() {
  const { error, success } = useAdminProductsContext();

  return (
    <>
      {error && <p className="mb-5 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-700" role="alert">{error}</p>}
      {success && <p className="mb-5 rounded border border-green-300 bg-green-50 px-4 py-3 text-green-700" role="status">{success}</p>}

      <ProductForm />
      <ProductsTable />
    </>
  );
}

/** Scopes the Admin Products context to the product-management tab. */
export function AdminProducts() {
  return (
    <AdminProductsProvider>
      <AdminProductsContent />
    </AdminProductsProvider>
  );
}
