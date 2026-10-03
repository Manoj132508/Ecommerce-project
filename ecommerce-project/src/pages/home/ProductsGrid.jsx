import { Product } from './Product';

export function ProductsGrid({ products }) {
  return (
    <div className="grid grid-cols-1 min-[380px]:grid-cols-2 min-[640px]:grid-cols-3 min-[900px]:grid-cols-4 min-[1150px]:grid-cols-5 min-[1400px]:grid-cols-6 min-[1700px]:grid-cols-7 min-[2000px]:grid-cols-8">
      {products.map((product) => {
        return (
          <Product key={product.id} product={product} />
        );
      })}
    </div>
  );
}
