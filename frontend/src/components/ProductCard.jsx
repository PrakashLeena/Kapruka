export default function ProductCard({ product, onAddToCart }) {
  const { name, price, currency, image, url, inStock } = product;
  const stockLabel = inStock === true ? "In stock" : inStock === false ? "Out of stock" : "Availability unknown";
  const stockClass = inStock === true
    ? "bg-teal/10 text-teal"
    : inStock === false
      ? "bg-red-100 text-red-600"
      : "bg-cream-200 text-charcoal/60";

  return (
    <div className="w-44 shrink-0 snap-start rounded-2xl bg-white border border-cream-200 overflow-hidden shadow-sm flex flex-col">
      <div className="relative h-32 bg-cream-100 flex items-center justify-center">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="text-3xl">🎁</span>
        )}

        {price != null && (
          <div className="price-tag absolute top-2 left-2 bg-gold text-charcoal text-xs font-semibold px-3 py-1 rounded-md shadow">
            {currency ?? "LKR"} {Number(price).toLocaleString()}
          </div>
        )}

        {inStock === false && (
          <div className="absolute inset-0 bg-charcoal/60 flex items-center justify-center">
            <span className="text-white text-xs font-medium">Out of stock</span>
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <p className="text-sm font-medium leading-snug line-clamp-2">{name}</p>
        <span className={`inline-flex w-fit text-[10px] px-2 py-0.5 rounded-full font-semibold ${stockClass}`}>
          {stockLabel}
        </span>

        <div className="mt-auto flex items-center gap-2">
          <button
            onClick={() => onAddToCart(product)}
            disabled={inStock === false}
            className="flex-1 bg-terracotta hover:bg-terracotta-dark disabled:bg-cream-200 disabled:text-charcoal/40 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
          >
            Add to cart
          </button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-cream-200 text-charcoal/50 hover:text-teal hover:border-teal transition-colors"
              aria-label={`View ${name} on Kapruka`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 5h5v5M19 5l-9 9M6 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
