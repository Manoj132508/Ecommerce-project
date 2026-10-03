import dayjs from 'dayjs';
import { useState } from 'react';
import { useCart } from '../../contexts/CartContext';
import { formatMoney } from '../../utils/money';
import { actionLink, selectInput } from '../../utils/tailwindClasses';
import { DeliveryOptions } from './DeliveryOptions';

export function OrderSummary() {
  const { cart, deliveryOptions, updateCartItem, removeFromCart } = useCart();
  const [productBeingUpdated, setProductBeingUpdated] = useState(null);
  const [updatedQuantity, setUpdatedQuantity] = useState(1);

  const startUpdatingQuantity = (cartItem) => {
    setProductBeingUpdated(cartItem.productId);
    setUpdatedQuantity(cartItem.quantity);
  };

  const updateQuantity = async (productId) => {
    try {
      await updateCartItem(productId, {
        quantity: updatedQuantity
      });
      setProductBeingUpdated(null);
    } catch {
      // CartContext exposes the request error to the checkout page.
    }
  };

  return (
    <section>
      {deliveryOptions.length > 0 && cart.map((cartItem) => {
        const deleteCartItem = async () => {
          try {
            await removeFromCart(cartItem.productId);
          } catch {
            // CartContext exposes the request error to the checkout page.
          }
        };

        if (!cartItem.product) {
          return (
            <article key={cartItem.productId} className="mb-3 rounded border border-red-300 bg-red-50 p-[18px]">
              <div className="grid grid-cols-[80px_1fr] items-center gap-5">
                <div className="flex h-20 w-20 items-center justify-center rounded bg-white text-3xl font-bold text-red-500">
                  !
                </div>
                <div>
                  <h2 className="mb-1 font-bold text-red-700">This product is no longer available</h2>
                  <p className="mb-3 text-sm text-gray-600">
                    Remove it from your cart before continuing to order confirmation.
                  </p>
                  <button type="button" className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700" onClick={deleteCartItem}>
                    Remove from cart
                  </button>
                </div>
              </div>
            </article>
          );
        }

        const selectedDeliveryOption = deliveryOptions
          .find((deliveryOption) => {
            return deliveryOption.id === cartItem.deliveryOptionId;
          });

        if (!selectedDeliveryOption) {
          return null;
        }

        return (
          <article key={cartItem.productId} className="mb-3 rounded border border-[#dedede] p-[18px]">
            <div className="mt-[5px] mb-[22px] text-[19px] font-bold text-[#198754]">
              Delivery date: {dayjs(selectedDeliveryOption.estimatedDeliveryTimeMs).format('dddd, MMMM D')}
            </div>

            <div className="grid grid-cols-[100px_1fr] gap-x-[25px] gap-y-[30px] min-[1001px]:grid-cols-[100px_1fr_1fr] min-[1001px]:gap-y-0">
              <img className="mx-auto max-h-[120px] max-w-full"
                src={cartItem.product.image} />

              <div>
                <div className="mb-2 font-bold">
                  {cartItem.product.name}
                </div>
                <div className="mb-[5px] font-bold">
                  {formatMoney(cartItem.product.priceCents)}
                </div>
                <div>
                  {productBeingUpdated === cartItem.productId ? (
                    <>
                      <label>
                        Quantity:{' '}
                        <select className={`${selectInput} mr-[3px]`} value={updatedQuantity}
                          onChange={(event) => setUpdatedQuantity(Number(event.target.value))}>
                          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <span className={`${actionLink} ml-[3px]`}
                        onClick={() => updateQuantity(cartItem.productId)}>
                        Save
                      </span>
                      <span className={`${actionLink} ml-[3px]`}
                        onClick={() => setProductBeingUpdated(null)}>
                        Cancel
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        Quantity: <span className="quantity-label">{cartItem.quantity}</span>
                      </span>
                      <span className={`${actionLink} ml-[3px]`}
                        onClick={() => startUpdatingQuantity(cartItem)}>
                        Update
                      </span>
                    </>
                  )}
                  <span className={`${actionLink} ml-[3px]`}
                    onClick={deleteCartItem}>
                    Delete
                  </span>
                </div>
              </div>

              <DeliveryOptions cartItem={cartItem} />
            </div>
          </article>
        );
      })}
    </section>
  );
}
