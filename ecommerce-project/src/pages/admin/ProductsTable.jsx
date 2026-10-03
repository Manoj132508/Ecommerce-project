import { formatMoney } from '../../utils/money';

/** Displays the current product catalog and delegates edit/delete actions to the page. */
export function ProductsTable({ products, loading, saving, onEdit, onDelete }) {
  return (
    <section className="rounded-lg bg-white p-6 shadow-md">
      <h2 className="mb-4 text-xl font-bold">Products</h2>
      {loading && products.length === 0 ? (
        <p>Loading products...</p>
      ) : products.length === 0 ? (
        <p className="text-gray-500">No products available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-left">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="p-3">Product</th>
                <th className="p-3">Category</th>
                <th className="p-3">Price</th>
                <th className="p-3">Stock</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <img className="h-12 w-12 object-contain" src={product.image} alt="" />
                      <span className="font-medium">{product.name}</span>
                    </div>
                  </td>
                  <td className="p-3">{product.category || '-'}</td>
                  <td className="p-3">{formatMoney(product.priceCents)}</td>
                  <td className="p-3">{product.stock ?? '-'}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button type="button" disabled={saving} className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50" onClick={() => onEdit(product)}>
                        Edit
                      </button>
                      <button type="button" disabled={saving} className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-50" onClick={() => onDelete(product)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
