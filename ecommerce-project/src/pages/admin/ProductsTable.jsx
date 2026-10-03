import { formatMoney } from '../../utils/money';

/** Displays the current product catalog and delegates edit/delete actions to the page. */
export function ProductsTable({ products, loading, saving, onEdit, onDelete }) {
  return (
    <section className="rounded-lg bg-white p-4 shadow-md sm:p-6">
      <h2 className="mb-4 text-xl font-bold">Products</h2>
      {loading && products.length === 0 ? (
        <p>Loading products...</p>
      ) : products.length === 0 ? (
        <p className="text-gray-500">No products available.</p>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {products.map((product) => (
              <article key={product.id} className="rounded border border-gray-200 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <img className="h-16 w-16 shrink-0 object-contain" src={product.image} alt="" />
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold">{product.name}</h3>
                    <p className="text-sm text-gray-600">{product.category || 'No category'}</p>
                    <p className="mt-1 text-sm"><span className="font-semibold">{formatMoney(product.priceCents)}</span> · Stock: {product.stock ?? '-'}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={saving} className="rounded bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-50" onClick={() => onEdit(product)}>
                    Edit
                  </button>
                  <button type="button" disabled={saving} className="rounded bg-red-600 px-3 py-2 text-white hover:bg-red-700 disabled:opacity-50" onClick={() => onDelete(product)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
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
        </>
      )}
    </section>
  );
}
