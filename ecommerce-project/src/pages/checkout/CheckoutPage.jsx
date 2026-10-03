import { useEffect } from 'react';
import { Link } from 'react-router';
import { useCart } from '../../contexts/CartContext';
import { OrderSummary } from './OrderSummary';
import { PaymentSummary } from './PaymentSummary';

export function CheckoutPage() {
  const {
    cart,
    loading: cartLoading,
    totalQuantity,
    error,
    loadCheckoutData
  } = useCart();

  useEffect(() => {
    if (!cartLoading) {
      loadCheckoutData().catch(() => {});
    }
  }, [cart, cartLoading, loadCheckoutData]);

  return (
    <>
      <title>Checkout</title>

      <header className="fixed inset-x-0 top-0 z-50 flex h-16 justify-center bg-white px-3 shadow-sm sm:px-[30px]">
        <div className="grid w-full max-w-[1100px] grid-cols-[auto_1fr_auto] items-center gap-2">
          <div className="min-w-0 sm:w-[200px]">
            <Link to="/" className="inline-block max-w-full cursor-pointer rounded-[2px] border border-transparent px-1.5 py-1.5 no-underline hover:border-[#198754] sm:px-[9.5px]">
              <div className="truncate text-base font-bold sm:text-[20px]">
                <span className="sm:hidden">Shop</span>
                <span className="hidden sm:inline">Ecommerce-Project</span>
              </div>
            </Link>
          </div>

          <div className="min-w-0 text-center text-base font-medium sm:text-xl min-[1001px]:text-[22px]">
            Checkout (<Link className="cursor-pointer text-[#198754] no-underline"
              to="/">{totalQuantity} {totalQuantity === 1 ? 'item' : 'items'}</Link>)
          </div>

          <div className="flex items-center justify-end text-right sm:w-[200px]">
            <img className="h-7 sm:h-8" src="/images/icons/checkout-lock-icon.png" alt="Secure checkout" />
          </div>
        </div>
      </header>

      <main className="mx-auto mb-16 mt-24 max-w-[1100px] px-3 sm:mb-[100px] sm:mt-[120px] sm:px-[30px]">
        <h1 className="mb-[18px] text-[22px] font-bold">Review your order</h1>

        {error && <p className="mb-4 text-red-700" role="alert">{error}</p>}

        <div className="grid grid-cols-1 items-start gap-x-3 min-[1001px]:grid-cols-[1fr_350px]">
          <OrderSummary />

          <PaymentSummary />
        </div>
      </main>
    </>
  );
}
