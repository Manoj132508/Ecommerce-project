import { formatMoney } from '../../utils/money';

/** Formats a saved customer address while supporting older orders without customer data. */
function formatAddress(customer) {
  if (!customer) return '-';
  return `${customer.address}, ${customer.city}, ${customer.postalCode}, ${customer.country}`;
}

/** Renders the administrator's complete order list, including user and customer details. */
export function AdminOrders({ orders, loading }) {
  return (
    <section className="rounded-lg bg-white p-4 shadow-md sm:p-6">
      <h2 className="mb-4 text-xl font-bold">Orders</h2>
      {loading && orders.length === 0 ? (
        <p>Loading orders...</p>
      ) : orders.length === 0 ? (
        <p className="text-gray-500">No orders available.</p>
      ) : (
        <div className="space-y-5">
          {orders.map((order) => (
            <article key={order.id} className="min-w-0 rounded border p-3 sm:p-4">
              <div className="mb-4 flex flex-col justify-between gap-2 border-b pb-3 sm:flex-row">
                <div>
                  <p className="break-all font-semibold">Order #{order.id}</p>
                  <p className="text-sm text-gray-500">{new Date(order.orderTimeMs).toLocaleString()}</p>
                </div>
                <p className="font-bold text-green-700">{formatMoney(order.totalCostCents)}</p>
              </div>

              <div className="mb-4 grid gap-2 rounded bg-gray-50 p-3 text-sm sm:grid-cols-2">
                <div>
                  <p><span className="font-semibold">Customer:</span> {order.customer?.fullName || 'Customer details unavailable'}</p>
                  <p><span className="font-semibold">Email:</span> {order.customer?.email || '-'}</p>
                  <p><span className="font-semibold">Phone:</span> {order.customer?.phone || '-'}</p>
                </div>
                <div>
                  <p><span className="font-semibold">User ID:</span> <span className="break-all">{order.userId || 'Legacy order'}</span></p>
                  <p><span className="font-semibold">Address:</span> {formatAddress(order.customer)}</p>
                </div>
              </div>

              <div className="space-y-3">
                {order.products.map((orderProduct) => (
                  <div key={orderProduct.productId} className="flex min-w-0 items-center gap-3 sm:gap-4">
                    {orderProduct.product && <img className="h-12 w-12 shrink-0 object-contain sm:h-14 sm:w-14" src={orderProduct.product.image} alt="" />}
                    <div className="min-w-0">
                      <p className="font-medium">{orderProduct.product?.name || 'Product unavailable'}</p>
                      <p className="text-sm text-gray-500">Quantity: {orderProduct.quantity}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
