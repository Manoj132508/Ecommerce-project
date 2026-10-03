import { useNavigate } from 'react-router';
import { useCart } from '../../contexts/CartContext';
import { formatMoney } from '../../utils/money';
import { primaryButton } from '../../utils/tailwindClasses';

export function PaymentSummary() {
  const navigate = useNavigate();
  const { cart, paymentSummary } = useCart();
  const hasUnavailableProducts = cart.some((item) => !item.product) ||
    Boolean(paymentSummary?.unavailableProductIds?.length);

  const continueToConfirmation = () => {
    if (!paymentSummary?.totalItems || hasUnavailableProducts) {
      return;
    }

    navigate('/order-confirmation');
  };

  return (
    <section className="row-start-1 mb-3 rounded border border-[#dedede] p-4 pb-[5px] sm:p-[18px] sm:pb-[5px] min-[1001px]:row-auto min-[1001px]:mb-0">
      <div className="mb-3 text-lg font-bold">
        Payment Summary
      </div>

      {paymentSummary && (
        <>
          {hasUnavailableProducts && (
            <p className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700" role="alert">
              Remove unavailable products from your cart before continuing.
            </p>
          )}

          <div className="mb-[9px] grid grid-cols-[1fr_auto] text-[15px]">
            <div>Items ({paymentSummary.totalItems}):</div>
            <div className="text-right">
              {formatMoney(paymentSummary.productCostCents)}
            </div>
          </div>

          <div className="mb-[9px] grid grid-cols-[1fr_auto] text-[15px]">
            <div>Shipping &amp; handling:</div>
            <div className="text-right">
              {formatMoney(paymentSummary.shippingCostCents)}
            </div>
          </div>

          <div className="mb-[9px] grid grid-cols-[1fr_auto] text-[15px] [&>div]:pt-[9px]">
            <div>Total before tax:</div>
            <div className="border-t border-[#dedede] text-right">
              {formatMoney(paymentSummary.totalCostBeforeTaxCents)}
            </div>
          </div>

          <div className="mb-[9px] grid grid-cols-[1fr_auto] text-[15px]">
            <div>Estimated tax (10%):</div>
            <div className="text-right">
              {formatMoney(paymentSummary.taxCents)}
            </div>
          </div>

          <div className="mb-[9px] grid grid-cols-[1fr_auto] border-t border-[#dedede] pt-[18px] text-lg font-bold text-[#198754]">
            <div>Order total:</div>
            <div className="text-right">
              {formatMoney(paymentSummary.totalCostCents)}
            </div>
          </div>

          <button className={`${primaryButton} mt-5 mb-[19px] w-full py-3`}
            disabled={paymentSummary.totalItems === 0 || hasUnavailableProducts}
            onClick={continueToConfirmation}>
            {hasUnavailableProducts ? 'Remove unavailable products' : 'Continue to confirmation'}
          </button>
        </>
      )}
    </section>
  );
}
