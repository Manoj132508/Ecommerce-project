import { Link, useLocation } from 'react-router';
import { Header } from '../../components/Header';

export function ProductUnavailablePage() {
  const location = useLocation();
  const productName = location.state?.productName;

  return (
    <>
      <title>Product Unavailable</title>
      <Header />

      <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-5 pt-[60px] text-center">
        <div className="w-full rounded-lg bg-white p-8 shadow-md">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-3xl text-red-600">
            !
          </div>
          <h1 className="mb-3 text-2xl font-bold text-gray-800">This product is no longer available</h1>
          <p className="mb-7 text-gray-600">
            {productName ? `${productName} has been removed from the store and cannot be added to your cart.` : 'This product has been removed from the store and cannot be added to your cart.'}
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/orders" className="rounded border border-gray-300 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-50">
              Back to orders
            </Link>
            <Link to="/" className="rounded bg-green-700 px-5 py-2 font-semibold text-white hover:bg-green-800">
              Continue shopping
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
