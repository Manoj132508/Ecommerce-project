import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { useAuthQuery } from '../../queries/useAuthQuery';
import { useAddToCartMutation } from '../../queries/useCartQueries';
import { formatMoney } from '../../utils/money';
import { primaryButton, selectInput } from '../../utils/tailwindClasses';
import type { ProductData } from '../../types/product';

interface ProductProps {
  product: ProductData;
}

export function Product({ product }: ProductProps) {
  const { data: user = null } = useAuthQuery();
  const addToCartMutation = useAddToCartMutation();
  const [quantity, setQuantity] = useState(1);
  const [showAddedMessage, setShowAddedMessage] = useState(false);
  const addedMessageTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (addedMessageTimeout.current) {
      clearTimeout(addedMessageTimeout.current);
    }
  }, []);

  const addToCart = async () => {
    try {
      if (!user) {
        alert('Please log or register in to add items to your cart.');
        return;
      }

      await addToCartMutation.mutateAsync({ productId: product.id, quantity });
      setShowAddedMessage(true);

      if (addedMessageTimeout.current) {
        clearTimeout(addedMessageTimeout.current);
      }

      addedMessageTimeout.current = setTimeout(() => {
        setShowAddedMessage(false);
      }, 2000);
    } catch {
      setShowAddedMessage(false);
    }
  };

  const selectQuantity = (event: ChangeEvent<HTMLSelectElement>) => {
    setQuantity(Number(event.target.value));
  };

  const productPath = `/products/${encodeURIComponent(product.id)}`;

  return (
    <article className="flex min-w-0 flex-col border-r border-b border-[#f0f0f0] px-3 pb-5 pt-6 sm:px-5 sm:pb-[25px] sm:pt-8 xl:px-[25px] xl:pt-10">
      <Link
        to={productPath}
        className="mb-4 flex p-0 h-[140px] items-center justify-center rounded-[5px] focus:outline-2 focus:outline-offset-2 focus:outline-[#198754] sm:h-[170px] xl:h-[180px]"
        aria-label={`View ${product.name}`}
      >
        <img
          className="max-h-full max-w-full rounded-[5px]"
          src={product.image}
          alt={product.name}
        />
      </Link>

      <Link
        to={productPath}
        className="mb-5px] pb-13 line-clamp-2 h-10 rounded-sm hover:text-[#198754] focus:outline-2 focus:outline-[#198754]"
      >
        {product.name}
      </Link>

      <div className="mb-[10px] flex items-center">
        <img
          className="mr-1.5 w-[90px] max-w-[75%] sm:w-[100px]"
          src={`images/ratings/rating-${product.rating.stars * 10}.png`}
          alt={`${product.rating.stars} out of 5 stars`}
        />
        <div className="mt-[3px] cursor-auto text-[#198754]">{product.rating.count}</div>
      </div>

      <div className="mb-[10px] font-bold">{formatMoney(product.priceCents)}</div>

      <div className="mb-[17px]">
        <select className={selectInput} value={quantity} onChange={selectQuantity}>
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>

      <div className="flex-1" />

      <div className={`mb-2 flex items-center text-base text-[#198754] transition-opacity ${showAddedMessage ? 'opacity-100' : 'opacity-0'}`}>
        <img className="mr-1.5 h-[19px]" src="/images/icons/checkmark.png" alt="" />
        Added
      </div>

      <button
        className={`${primaryButton} mt-px h-[34px] w-full p-2`}
        onClick={addToCart}
        disabled={addToCartMutation.isPending}
      >
        {addToCartMutation.isPending ? 'Adding...' : 'Add to Cart'}
      </button>
    </article>
  );
}
