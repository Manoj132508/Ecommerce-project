import dayjs from 'dayjs';
import { useEffect, Fragment } from 'react';
import { Link, useNavigate } from 'react-router';
import { Header } from '../../components/Header';
import { useCart } from '../../contexts/CartContext';
import { useOrders } from '../../contexts/OrdersContext';
import { formatMoney } from '../../utils/money';
import { primaryButton, secondaryButton } from '../../utils/tailwindClasses';

export function OrdersPage() {
  const navigate = useNavigate();
  const { addToCart, error: cartError, clearError: clearCartError } = useCart();
  const { orders, loading, error, loadOrders } = useOrders();

  useEffect(() => {
    loadOrders().catch(() => {});
  }, [loadOrders]);

  const buyAgain = async (productId, productName) => {
    try {
      await addToCart(productId, 1);
    } catch (requestError) {
      if (requestError.response?.status === 404) {
        clearCartError();
        navigate('/product-unavailable', { state: { productName } });
      }
    }
  };

  return (
    <>
      <title>Orders</title>

      <Header />

      <main className="mx-auto mb-[100px] mt-[132px] max-w-[850px] px-3 sm:px-5 xl:mt-[90px]">
        <h1 className="mb-[25px] text-2xl font-bold sm:text-[26px]">Your Orders</h1>

        {(error || cartError) && (
          <p className="mb-5 text-red-700" role="alert">{error || cartError}</p>
        )}
        {loading && orders.length === 0 && <p>Loading orders...</p>}

        <div className="grid grid-cols-1 gap-y-[50px]">
          {orders.map((order) => {
            return (
              <article key={order.id}>

                <div className="flex flex-col items-start justify-between rounded-t-[5px] border border-[#dedede] bg-white p-[15px] leading-[23px] min-[576px]:flex-row min-[576px]:items-center min-[576px]:px-[25px] min-[576px]:py-5 min-[576px]:leading-normal">
                  <div className="flex shrink-0 flex-col min-[576px]:flex-row">
                    <div className="mr-0 grid grid-cols-[auto_1fr] min-[576px]:mr-[45px] min-[576px]:block">
                      <div className="mr-[5px] font-bold min-[576px]:mr-0">Order Placed:</div>
                      <div>{dayjs(order.orderTimeMs).format('MMMM D')}</div>
                    </div>
                    <div className="mr-0 grid grid-cols-[auto_1fr] min-[576px]:mr-[45px] min-[576px]:block">
                      <div className="mr-[5px] font-bold min-[576px]:mr-0">Total:</div>
                      <div>{formatMoney(order.totalCostCents)}</div>
                    </div>
                  </div>

                  <div className="grid min-w-0 grid-cols-[auto_1fr] min-[576px]:block min-[576px]:shrink">
                    <div className="mr-[5px] font-bold min-[576px]:mr-0">Order ID:</div>
                    <div className="break-all">{order.id}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 items-center gap-x-[35px] gap-y-0 rounded-b-[5px] border border-t-0 border-[#dedede] px-4 pb-2 pt-8 min-[451px]:grid-cols-[110px_1fr] min-[451px]:px-[25px] min-[451px]:pt-10 min-[801px]:grid-cols-[110px_1fr_220px] min-[801px]:gap-y-[60px] min-[801px]:pb-10">
                  {order.products.map((orderProduct) => {
                    const product = orderProduct.product;

                    return (
                      <Fragment key={orderProduct.productId}>
                        <div className="mb-[25px] text-center min-[451px]:mb-0">
                          {product ? (
                            <img className="mx-auto max-h-[150px] max-w-[150px] min-[451px]:max-h-[110px] min-[451px]:max-w-[110px]"
                              src={product.image} alt={product.name} />
                          ) : (
                            <div className="mx-auto flex h-[110px] w-[110px] items-center justify-center rounded bg-gray-100 px-2 text-center text-xs text-gray-500">
                              Product unavailable
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="mb-[10px] font-bold min-[451px]:mb-[5px]">
                            {product?.name || 'Product no longer available'}
                          </div>
                          <div className="mb-[3px]">
                            Arriving on: {dayjs(orderProduct.estimatedDeliveryTimeMs).format('MMMM D')}
                          </div>
                          <div className="mb-[15px] min-[451px]:mb-2">
                            Quantity: {orderProduct.quantity}
                          </div>
                          <button className={`${primaryButton} mb-[15px] flex h-9 w-full items-center justify-center min-[451px]:mb-[10px] min-[451px]:w-[140px] min-[801px]:mb-0`}
                            onClick={() => buyAgain(orderProduct.productId, product?.name)}>
                            <img className="mr-[10px] w-5" src="/images/icons/buy-again.png" alt="" />
                            <span className="buy-again-message">Add to Cart</span>
                          </button>
                        </div>

                        <div className="col-auto mb-[70px] self-start min-[451px]:col-start-2 min-[451px]:mb-[30px] min-[801px]:col-auto min-[801px]:mb-0">
                          <Link to={`/tracking?orderId=${order.id}&productId=${orderProduct.productId}`}>
                            <button className={`${secondaryButton} w-full p-3 min-[451px]:w-[140px] min-[451px]:p-2 min-[801px]:w-full`}>
                              Track package
                            </button>
                          </Link>
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </>
  );
}
