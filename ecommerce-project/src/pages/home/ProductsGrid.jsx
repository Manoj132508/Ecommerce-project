import { Product } from './Product';

export function ProductsGrid({ products }) {
  return (
    <div className="grid grid-cols-1 min-[451px]:grid-cols-2 min-[576px]:grid-cols-3 min-[801px]:grid-cols-4 min-[1001px]:grid-cols-5 min-[1301px]:grid-cols-6 min-[1601px]:grid-cols-7 min-[2001px]:grid-cols-8">
      {products.map((product) => {
        return (
          <Product key={product.id} product={product} />
        );
      })}
    </div>
  );
}
