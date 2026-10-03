import dayjs from 'dayjs';
import { useCart } from '../../contexts/CartContext';
import { formatMoney } from '../../utils/money';

export function DeliveryOptions({ cartItem }) {
  const { deliveryOptions, updateCartItem } = useCart();
  return (
    <div className="col-span-2 min-[1001px]:col-auto">
      <div className="mb-[10px] font-bold">
        Choose a delivery option:
      </div>
      {deliveryOptions.map((deliveryOption) => {
        let priceString = 'FREE Shipping';

        if (deliveryOption.priceCents > 0) {
          priceString = `${formatMoney(deliveryOption.priceCents)} - Shipping`;
        }

        const updateDeliveryOption = async () => {
          try {
            await updateCartItem(cartItem.productId, {
              deliveryOptionId: deliveryOption.id
            });
          } catch {
            // CartContext exposes the request error to the checkout page.
          }
        };

        return (
          <div key={deliveryOption.id} className="mb-3 grid cursor-pointer grid-cols-[24px_1fr]"
            onClick={updateDeliveryOption}>
            <input type="radio"
              checked={deliveryOption.id === cartItem.deliveryOptionId}
              onChange={() => {}}
              className="mt-[3px] mr-[5px] cursor-pointer accent-[#198754]"
              name={`delivery-option-${cartItem.productId}`} />
            <div>
              <div className="mb-[3px] font-medium">
                {dayjs(deliveryOption.estimatedDeliveryTimeMs).format('dddd, MMMM D')}
              </div>
              <div className="text-[15px] text-[#787878]">
                {priceString}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
