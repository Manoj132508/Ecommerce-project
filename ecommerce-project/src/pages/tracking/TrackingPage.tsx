import dayjs from 'dayjs';
import { Link, useSearchParams } from 'react-router';
import { Header } from '../../components/Header';
import { useOrderQuery } from '../../queries/useOrdersQueries';
import { actionLink } from '../../utils/tailwindClasses';

export function TrackingPage() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const productId = searchParams.get('productId');
  const orderQuery = useOrderQuery(orderId);
  const order = orderQuery.data;
  const orderProduct = order?.products.find((item) => item.productId === productId);

  if (orderQuery.isPending && orderId) {
    return <><Header /><main className="mx-auto mt-[132px] max-w-[850px] px-3 sm:px-[30px] xl:mt-[90px]">Loading package...</main></>;
  }

  if (!order || !orderProduct) {
    return (
      <><title>Tracking</title><Header /><main className="mx-auto mt-[132px] max-w-[850px] px-3 sm:px-[30px] xl:mt-[90px]"><Link className={`${actionLink} mb-[30px] inline-block`} to="/orders">View all orders</Link><p className="mt-5">Package details could not be found.</p></main></>
    );
  }

  const now = Date.now();
  const deliveryTime = orderProduct.estimatedDeliveryTimeMs;
  const shippingTime = order.orderTimeMs + ((deliveryTime - order.orderTimeMs) / 3);
  const status = now >= deliveryTime ? 'Delivered' : now >= shippingTime ? 'Shipped' : 'Preparing';
  const progress = Math.min(100, Math.max(5, ((now - order.orderTimeMs) / (deliveryTime - order.orderTimeMs)) * 100));

  return (
    <><title>Tracking</title><Header /><main className="mx-auto mt-[132px] max-w-[850px] px-3 sm:px-[30px] xl:mt-[90px]"><div className="max-w-[500px]">
      <Link className={`${actionLink} mb-[30px] inline-block`} to="/orders">View all orders</Link>
      <div className="mb-[10px] text-xl font-bold sm:text-[25px]">Arriving on {dayjs(deliveryTime).format('dddd, MMMM D')}</div>
      <div className="mb-[3px]">{orderProduct.product?.name || 'Product no longer available'}</div><div className="mb-[3px]">Quantity: {orderProduct.quantity}</div>
      {orderProduct.product && <img className="mb-[50px] mt-[25px] max-h-[150px] max-w-[150px]" src={orderProduct.product.image} alt={orderProduct.product.name} />}
      <div className="mb-[15px] flex justify-between text-base font-medium min-[576px]:text-xl">{['Preparing', 'Shipped', 'Delivered'].map((label) => <div key={label} className={status === label ? 'text-[#198754]' : ''}>{label}</div>)}</div>
      <div className="h-[25px] w-full overflow-hidden rounded-[50px] border border-[#c8c8c8]"><div className="h-full rounded-[50px] bg-[#198754]" style={{ width: `${progress}%` }} /></div>
    </div></main></>
  );
}
