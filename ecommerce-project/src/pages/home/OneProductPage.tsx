import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Header } from '../../components/Header';
import { useRequireLogin } from '../../hooks/useRequireLogin';
import { useAuthQuery } from '../../queries/useAuthQuery';
import { useAddToCartMutation } from '../../queries/useCartQueries';
import { useProductsQuery } from '../../queries/useProductsQuery';
import { getErrorMessage } from '../../services/api';
import { CART_LOGIN_NOTICE } from '../../slices/authUiSlice';
import { formatMoney } from '../../utils/money';
import { primaryButton, secondaryButton, selectInput } from '../../utils/tailwindClasses';

export function OneProductPage() {
  const { productId } = useParams<{ productId: string }>();
  const { data: products = [], error, isError, isPending } = useProductsQuery();
  const { data: user = null } = useAuthQuery();
  const addToCartMutation = useAddToCartMutation();
  const requireLogin = useRequireLogin();
  const [quantity, setQuantity] = useState(1);
  const [showAddedMessage, setShowAddedMessage] = useState(false);
  const addedMessageTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const product = products.find((item) => item.id === productId);

  useEffect(() => () => {
    if (addedMessageTimeout.current) {
      clearTimeout(addedMessageTimeout.current);
    }
  }, []);

  const selectQuantity = (event: ChangeEvent<HTMLSelectElement>) => {
    setQuantity(Number(event.target.value));
    setShowAddedMessage(false);
  };

  const addToCart = async () => {
    if (!product) {
      return;
    }

    if (!user) {
      requireLogin(CART_LOGIN_NOTICE);
      return;
    }

    try {
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

  const productsError = isError
    ? getErrorMessage(error, 'Unable to load this product. Please try again.')
    : '';
  const cartError = addToCartMutation.isError
    ? getErrorMessage(addToCartMutation.error, 'Unable to add this product to your cart.')
    : '';

  if (isPending) {
    return (
      <>
        <title>Loading product</title>
        <Header />
        <main className="mt-[108px] p-8 text-center xl:mt-[60px]">Loading product...</main>
      </>
    );
  }

  if (!product || productsError) {
    return (
      <>
        <title>Product not found</title>
        <Header />
        <main className="mt-[108px] flex min-h-[calc(100vh-108px)] flex-col items-center justify-center gap-5 p-6 text-center xl:mt-[60px] xl:min-h-[calc(100vh-60px)]">
          <h2 className="text-2xl font-bold">Product not found</h2>
          <p className={productsError ? 'text-red-700' : 'text-[#555]'}>
            {productsError || 'The product may have been removed or the link is incorrect.'}
          </p>
          <Link className={`${secondaryButton} px-5 py-2.5 no-underline`} to="/">
            Back to products
          </Link>
        </main>
      </>
    );
  }

  const imageSource = product.image.startsWith('http') || product.image.startsWith('/')
    ? product.image
    : `/${product.image}`;

  return (
    <>
      <title>{product.name}</title>
      <Header />

      <main className="mt-[108px] min-h-[calc(100vh-108px)] bg-[#f7f7f7] px-4 py-6 xl:mt-[60px] xl:min-h-[calc(100vh-60px)] xl:px-8 xl:py-10">
        <div className="mx-auto max-w-6xl">
          <Link className="mb-5 inline-block font-semibold text-[#198754] hover:opacity-75" to="/">
            &larr; Back to products
          </Link>

          <article className="grid gap-8 rounded-lg bg-white p-5 shadow-sm md:grid-cols-2 md:p-8 xl:gap-12 xl:p-10">
            <div className="flex min-h-[300px] items-center justify-center rounded-lg bg-[#fafafa] p-5 sm:min-h-[420px]">
              <img
                className="max-h-[500px] max-w-full object-contain"
                src={imageSource}
                alt={product.name}
              />
            </div>

            <div className="flex flex-col justify-center">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#198754]">
                {product.category || 'Product'}
              </p>
              <h1 className="mb-4 text-2xl font-bold leading-tight sm:text-3xl xl:text-4xl">
                {product.name}
              </h1>

              <div className="mb-5 flex items-center gap-3">
                <img
                  className="w-[100px]"
                  src={`/images/ratings/rating-${product.rating.stars * 10}.png`}
                  alt={`${product.rating.stars} out of 5 stars`}
                />
                <span className="text-[#555]">{product.rating.count} ratings</span>
              </div>

              <p className="mb-5 text-3xl font-bold text-[#084f2d]">
                {formatMoney(product.priceCents)}
              </p>

              <div className="mb-5 flex items-center gap-3">
                <label className="font-semibold" htmlFor="product-quantity">Quantity:</label>
                <select
                  id="product-quantity"
                  className={`${selectInput} min-w-20 py-2`}
                  value={quantity}
                  onChange={selectQuantity}
                >
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>

              <div className="mb-3 min-h-6" aria-live="polite">
                {showAddedMessage && (
                  <span className="flex items-center text-[#198754]">
                    <img className="mr-2 h-[19px]" src="/images/icons/checkmark.png" alt="" />
                    Added {quantity} to your cart
                  </span>
                )}
                {cartError && <p className="text-red-700" role="alert">{cartError}</p>}
              </div>

              <button
                type="button"
                className={`${primaryButton} w-full px-6 py-3 text-base sm:max-w-sm`}
                onClick={addToCart}
                disabled={addToCartMutation.isPending}
              >
                {addToCartMutation.isPending ? 'Adding...' : 'Add to Cart'}
              </button>
            </div>

            <section className="border-t border-[#e5e5e5] pt-8 md:col-span-2" aria-label="Product information">
              <div className="grid gap-8 lg:grid-cols-2">
                <div>
                  <h2 className="mb-3 text-2xl font-bold text-[#084f2d]">About this product</h2>
                  <p className="leading-7 text-[#555]">{product.description}</p>
                </div>

                <div>
                  <h2 className="mb-3 text-2xl font-bold text-[#084f2d]">How it works</h2>
                  <p className="leading-7 text-[#555]">{product.howItWorks}</p>
                </div>

                <div>
                  <h2 className="mb-3 text-2xl font-bold text-[#084f2d]">Product highlights</h2>
                  <ul className="grid gap-2 text-[#555] sm:grid-cols-2">
                    {product.highlights.map((highlight) => (
                      <li key={highlight} className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-[#198754]" />
                        {highlight}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h2 className="mb-3 text-2xl font-bold text-[#084f2d]">Care and guidance</h2>
                  <p className="leading-7 text-[#555]">{product.careInstructions}</p>
                </div>
              </div>
            </section>
          </article>
        </div>
      </main>
    </>
  );
}
