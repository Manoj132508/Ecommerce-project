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

      <header className="fixed inset-x-0 top-0 z-50 flex h-[60px] justify-center bg-white px-[30px]">
        <div className="flex w-full max-w-[1100px] items-center">
          <div className="w-auto min-[576px]:w-[200px]">
            <Link to="/" className="inline-block cursor-pointer rounded-[2px] border border-transparent px-[9.5px] py-1.5 no-underline hover:border-[#198754]">
              <div>
                <h1 className='text-[20px] font-bold'>Ecommerce-Project</h1>
              </div>
            </Link>
          </div>

          <div className="mr-[5px] flex flex-1 shrink-0 justify-center text-center text-xl font-medium min-[576px]:mr-[60px] min-[1001px]:mr-0 min-[1001px]:text-[22px]">
            Checkout (<Link className="cursor-pointer text-[#198754] no-underline"
              to="/">{totalQuantity} {totalQuantity === 1 ? 'item' : 'items'}</Link>)
          </div>

          <div className="flex w-auto items-center justify-end text-right min-[1001px]:w-[200px]">
            <img className="h-8" src="images/icons/checkout-lock-icon.png" />
          </div>
        </div>
      </header>

      <main className="mx-auto mt-[140px] mb-[100px] max-w-[1100px] px-[30px]">
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
