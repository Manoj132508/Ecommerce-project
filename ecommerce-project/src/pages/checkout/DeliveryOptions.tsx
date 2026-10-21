import dayjs from 'dayjs';
import { useCheckoutQuery, useUpdateCartItemMutation } from '../../queries/useCartQueries';
import { getErrorMessage } from '../../services/api';
import type { CartItem } from '../../types/cart';
import { formatMoney } from '../../utils/money';

interface DeliveryOptionsProps {
  cartItem: CartItem;
}

export function DeliveryOptions({ cartItem }: DeliveryOptionsProps) {
  const { data: checkoutData } = useCheckoutQuery();
  const updateCartItem = useUpdateCartItemMutation();
  const deliveryOptions = checkoutData?.deliveryOptions ?? [];

  return (
    <div className="col-span-2 min-[1001px]:col-auto">
      <div className="mb-[10px] font-bold">Choose a delivery option:</div>
      {updateCartItem.error && (
        <p className="mb-2 text-sm text-red-700" role="alert">
          {getErrorMessage(updateCartItem.error, 'Unable to update the delivery option.')}
        </p>
      )}
      {deliveryOptions.map((deliveryOption) => {
        const priceString = deliveryOption.priceCents > 0
          ? `${formatMoney(deliveryOption.priceCents)} - Shipping`
          : 'FREE Shipping';

        const updateDeliveryOption = () => {
          updateCartItem.mutate({
            productId: cartItem.productId,
            updates: { deliveryOptionId: deliveryOption.id },
          });
        };

        return (
          <label key={deliveryOption.id} className="mb-3 grid cursor-pointer grid-cols-[24px_1fr]">
            <input type="radio" checked={deliveryOption.id === cartItem.deliveryOptionId} onChange={updateDeliveryOption} className="mr-[5px] mt-[3px] cursor-pointer accent-[#198754]" name={`delivery-option-${cartItem.productId}`} />
            <span>
              <span className="mb-[3px] block font-medium">{dayjs(deliveryOption.estimatedDeliveryTimeMs).format('dddd, MMMM D')}</span>
              <span className="text-[15px] text-[#787878]">{priceString}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
