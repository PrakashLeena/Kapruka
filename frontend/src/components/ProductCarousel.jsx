import ProductCard from "./ProductCard.jsx";

export default function ProductCarousel({ products, onAddToCart }) {
  if (!products || products.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 pt-1 -mx-1 px-1 snap-x">
      {products.map((product, i) => (
        <ProductCard key={product.id ?? i} product={product} onAddToCart={onAddToCart} />
      ))}
    </div>
  );
}
