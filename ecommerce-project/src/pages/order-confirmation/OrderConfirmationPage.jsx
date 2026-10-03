import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Header } from '../../components/Header';
import { useAuth } from '../../contexts/AuthContext';
import { useCart } from '../../contexts/CartContext';
import { useOrders } from '../../contexts/OrdersContext';
import { formatMoney } from '../../utils/money';

const emptyCustomer = {
  fullName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  postalCode: '',
  country: ''
};

export function OrderConfirmationPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { cart, paymentSummary, checkoutLoading, loadCheckoutData } = useCart();
  const { createOrder, error } = useOrders();
  const [customer, setCustomer] = useState(emptyCustomer);
  const [submitting, setSubmitting] = useState(false);
  const hasUnavailableProducts = cart.some((item) => !item.product) ||
    Boolean(paymentSummary?.unavailableProductIds?.length);

  useEffect(() => {
    if (user) {
      setCustomer((current) => ({
        ...current,
        fullName: current.fullName || user.name || '',
        email: current.email || user.email || ''
      }));
      loadCheckoutData().catch(() => {});
    }
  }, [user, loadCheckoutData]);

  if (authLoading) {
    return <p className="p-8 text-center">Loading...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: '/order-confirmation' }} />;
  }

  const handleChange = (event) => {
    setCustomer((current) => ({
      ...current,
     [event.target.name]: event.target.value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting || !paymentSummary?.totalItems || hasUnavailableProducts) return;

    setSubmitting(true);
    try {
      await createOrder(customer);
      navigate('/orders', { replace: true });
    } catch {
      // OrdersContext exposes the request error below the form.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <title>Confirm Your Order</title>
      <Header />

      <main className="mx-auto max-w-[1050px] px-3 pb-16 pt-[132px] sm:px-5 xl:pt-[90px]">
        <h1 className="mb-2 text-2xl font-bold text-gray-800 sm:text-3xl">Confirm your order</h1>
        <p className="mb-7 text-gray-600">Enter your contact and delivery details before placing the order.</p>

        {error && (
          <p className="mb-5 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-700" role="alert">
            {error}
          </p>
        )}
        {hasUnavailableProducts && (
          <div className="mb-5 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-700" role="alert">
            <p className="font-semibold">Your cart contains a product that is no longer available.</p>
            <Link to="/checkout" className="mt-1 inline-block underline">Return to checkout and remove it.</Link>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
          <form onSubmit={handleSubmit} className="rounded-lg bg-white p-4 shadow-md sm:p-6">
            <h2 className="mb-5 text-xl font-bold">Customer details</h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Full name</span>
                <input name="fullName" value={customer.fullName} onChange={handleChange} autoComplete="name" maxLength="100" className="w-full rounded border px-3 py-2" required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
                <input type="email" name="email" value={customer.email} onChange={handleChange} autoComplete="email" maxLength="160" className="w-full rounded border px-3 py-2" required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Phone</span>
                <input type="tel" name="phone" value={customer.phone} onChange={handleChange} autoComplete="tel" maxLength="30" className="w-full rounded border px-3 py-2" required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Country</span>
                <input name="country" value={customer.country} onChange={handleChange} autoComplete="country-name" maxLength="80" className="w-full rounded border px-3 py-2" required />
              </label>
              <label className="block md:col-span-2">
                <span className="mb-1 block text-sm font-medium text-gray-700">Address</span>
                <input name="address" value={customer.address} onChange={handleChange} autoComplete="street-address" maxLength="200" className="w-full rounded border px-3 py-2" required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">City</span>
                <input name="city" value={customer.city} onChange={handleChange} autoComplete="address-level2" maxLength="80" className="w-full rounded border px-3 py-2" required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Postal code</span>
                <input name="postalCode" value={customer.postalCode} onChange={handleChange} autoComplete="postal-code" maxLength="20" className="w-full rounded border px-3 py-2" required />
              </label>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Link to="/checkout" className="rounded border px-5 py-2 text-center font-semibold text-gray-700 hover:bg-gray-50">
                Back to checkout
              </Link>
              <button type="submit" disabled={submitting || !paymentSummary?.totalItems || hasUnavailableProducts} className="rounded bg-green-700 px-5 py-2 font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-gray-400">
                {submitting ? 'Placing order...' : hasUnavailableProducts ? 'Remove unavailable products' : 'Confirm and place order'}
              </button>
            </div>
          </form>

          <aside className="rounded-lg bg-white p-4 shadow-md sm:p-6">
            <h2 className="mb-4 text-xl font-bold">Order summary</h2>
            {checkoutLoading && !paymentSummary ? (
              <p>Loading order...</p>
            ) : !paymentSummary || cart.length === 0 ? (
              <div>
                <p className="mb-3 text-gray-500">Your cart is empty.</p>
                <Link to="/" className="font-semibold text-blue-600 hover:underline">Continue shopping</Link>
              </div>
            ) : (
              <>
                <div className="mb-4 max-h-64 space-y-3 overflow-y-auto border-b pb-4">
                  {cart.map((item) => (
                    <div key={item.productId} className="flex items-center gap-3">
                      {item.product ? (
                        <>
                          <img src={item.product.image} alt="" className="h-12 w-12 object-contain" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{item.product.name}</p>
                            <p className="text-xs text-gray-500">Quantity: {item.quantity}</p>
                          </div>
                        </>
                      ) : (
                        <div className="rounded bg-red-50 p-2 text-sm font-medium text-red-700">
                          Product no longer available
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Items</span><span>{formatMoney(paymentSummary.productCostCents)}</span></div>
                  <div className="flex justify-between"><span>Shipping</span><span>{formatMoney(paymentSummary.shippingCostCents)}</span></div>
                  <div className="flex justify-between"><span>Tax</span><span>{formatMoney(paymentSummary.taxCents)}</span></div>
                  <div className="flex justify-between border-t pt-3 text-lg font-bold text-green-700"><span>Total</span><span>{formatMoney(paymentSummary.totalCostCents)}</span></div>
                </div>
              </>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
