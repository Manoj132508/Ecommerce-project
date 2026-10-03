import { useEffect, useRef, useState } from 'react';
import { useCart } from '../../contexts/CartContext';
import { formatMoney } from '../../utils/money';
import { primaryButton, selectInput } from '../../utils/tailwindClasses';
import { useAuth } from '../../contexts/AuthContext';

export function Product({ product }) {
  const { addToCart: addProductToCart } = useCart();
  const { user } = useAuth();
  const [quantity, setQuantity] = useState(1);
  const [showAddedMessage, setShowAddedMessage] = useState(false);
  const addedMessageTimeout = useRef(null);

  useEffect(() => {
    return () => clearTimeout(addedMessageTimeout.current);
  }, []);

  const addToCart = async () => {
    try {
      if (!user) {
        alert('Please log or register in to add items to your cart.');
        return;
      }
      await addProductToCart(product.id, quantity);

      setShowAddedMessage(true);
      clearTimeout(addedMessageTimeout.current);
      addedMessageTimeout.current = setTimeout(() => {
        setShowAddedMessage(false);
      }, 2000);
    } catch {
      setShowAddedMessage(false);
    }
  };

  const selectQuantity = (event) => {
    const quantitySelected = Number(event.target.value);
    setQuantity(quantitySelected);
  };

  return (
    <article className="flex flex-col border-r border-b border-[#f0f0f0] px-[25px] pt-10 pb-[25px]">
      <div className="mb-5 flex h-[180px] items-center justify-center">
        <img className="max-h-full max-w-full rounded-[5px]"
          src={product.image} />
      </div>

      <div className="mb-[5px] line-clamp-2 h-10">
        {product.name}
      </div>

      <div className="mb-[10px] flex items-center">
        <img className="mr-1.5 w-[100px]"
          src={`images/ratings/rating-${product.rating.stars * 10}.png`} />
        <div className="mt-[3px] cursor-auto text-[#198754]">
          {product.rating.count}
        </div>
      </div>

      <div className="mb-[10px] font-bold">
        {formatMoney(product.priceCents)}
      </div>

      <div className="mb-[17px]">
        <select className={selectInput} value={quantity} onChange={selectQuantity}>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
          <option value="6">6</option>
          <option value="7">7</option>
          <option value="8">8</option>
          <option value="9">9</option>
          <option value="10">10</option>
        </select>
      </div>

      <div className="flex-1"></div>

      <div className={`mb-2 flex items-center text-base text-[#198754] transition-opacity ${showAddedMessage ? 'opacity-100' : 'opacity-0'}`}>
        <img className="mr-1.5 h-[19px]" src="images/icons/checkmark.png" />
        Added
      </div>

      <button className={`${primaryButton} mt-px h-[34px] w-full p-2`}
        onClick={addToCart}>
        Add to Cart
      </button>
    </article>
  );
}
