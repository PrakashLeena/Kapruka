import { useState } from "react";

export default function RightPane({ products, onAddToCart, selectedProduct, setSelectedProduct }) {
  if (!products || products.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-cream-50/50">
        <div className="w-20 h-20 rounded-full bg-cream-200 flex items-center justify-center text-4xl mb-4 animate-pulse">
          🛍️
        </div>
        <h3 className="font-display text-xl text-charcoal font-semibold">Product Catalog</h3>
        <p className="text-sm text-charcoal/60 max-w-sm mt-2">
          Ask me to search for gifts, cakes, flowers, or chocolates! Suitable options will appear here dynamically.
        </p>
      </div>
    );
  }

  // If a single product is selected, show its full detail view
  if (selectedProduct) {
    const { name, price, currency, image, url, inStock, sourceTool } = selectedProduct;
    const stockLabel = inStock === true ? "In Stock" : inStock === false ? "Out of stock" : "Availability unknown";
    const stockClass = inStock === true
      ? "bg-teal/10 text-teal"
      : inStock === false
        ? "bg-red-100 text-red-600"
        : "bg-cream-200 text-charcoal/60";
    return (
      <div className="h-full flex flex-col bg-white">
        {/* Back header */}
        <div className="shrink-0 border-b border-cream-200 p-4 flex items-center gap-3">
          <button
            onClick={() => setSelectedProduct(null)}
            className="p-1.5 rounded-lg hover:bg-cream-100 text-charcoal/70 transition-colors"
            aria-label="Back to results"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-display font-medium text-charcoal text-sm">Back to results</span>
        </div>

        {/* Detail content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          <div className="w-full aspect-video bg-cream-50 rounded-2xl border border-cream-200 overflow-hidden flex items-center justify-center relative">
            {image ? (
              <img src={image} alt={name} className="w-full h-full object-contain" />
            ) : (
              <span className="text-6xl">🎁</span>
            )}
            {inStock === false && (
              <div className="absolute inset-0 bg-charcoal/60 flex items-center justify-center">
                <span className="text-white text-sm font-semibold tracking-wider uppercase">Out of stock</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-bold leading-tight text-charcoal">{name}</h2>
            {price != null && (
              <div className="text-2xl font-bold text-terracotta">
                {currency ?? "LKR"} {Number(price).toLocaleString()}
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-1">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${stockClass}`}>
                {inStock === true ? "● In Stock" : inStock === false ? "● Out of stock" : "● Availability unknown"}
              </span>
              {sourceTool && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-cream-200 text-charcoal/60 font-medium">
                  Source: {sourceTool.replace(/^kapruka_/, "")}
                </span>
              )}
            </div>
          </div>

          <div className="mt-auto pt-6 border-t border-cream-100 flex flex-col gap-3">
            <button
              onClick={() => onAddToCart(selectedProduct)}
              disabled={inStock === false}
              className="w-full bg-terracotta hover:bg-terracotta-dark disabled:bg-cream-200 disabled:text-charcoal/40 text-white font-semibold py-3 rounded-xl shadow-md hover:shadow transition-all text-sm flex items-center justify-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              Add to Shopping Cart
            </button>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="w-full text-center border border-cream-200 text-charcoal/70 hover:text-teal hover:border-teal font-semibold py-3 rounded-xl transition-all text-sm flex items-center justify-center gap-2"
              >
                View on Kapruka Website
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                </svg>
              </a>
            )}
          </div>

          {/* Related Products Section */}
          {(() => {
            const related = products.filter(p => p.id !== selectedProduct.id).slice(0, 4);
            if (related.length === 0) return null;
            return (
              <div className="mt-6 pt-6 border-t border-cream-100">
                <h4 className="font-display font-bold text-charcoal text-xs mb-3 uppercase tracking-wider text-charcoal/60">
                  You might also like
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {related.map((p, idx) => (
                    <div
                      key={p.id ?? idx}
                      onClick={() => setSelectedProduct(p)}
                      className="cursor-pointer rounded-xl border border-cream-200/80 p-2 hover:border-teal hover:shadow-sm transition-all flex flex-col bg-cream-50/20"
                    >
                      <div className="h-16 bg-white rounded-lg flex items-center justify-center overflow-hidden mb-1.5 relative border border-cream-100">
                        {p.image ? (
                          <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xl">🎁</span>
                        )}
                      </div>
                      <p className="text-[10px] font-semibold text-charcoal line-clamp-1 leading-snug">
                        {p.name}
                      </p>
                      {p.price != null && (
                        <p className="text-[10px] font-bold text-terracotta mt-0.5">
                          {p.currency ?? "LKR"} {Number(p.price).toLocaleString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 border-b border-cream-200 p-4 flex items-center justify-between">
        <h2 className="font-display font-bold text-charcoal text-base">Suitable Products</h2>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal/10 text-teal">
          {products.length} {products.length === 1 ? "item" : "items"} found
        </span>
      </div>

      {/* Grid List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {products.map((product, i) => {
            const { id, name, price, currency, image, inStock } = product;
            return (
              <div
                key={id ?? i}
                onClick={() => setSelectedProduct(product)}
                className="group cursor-pointer rounded-2xl bg-white border border-cream-200 overflow-hidden shadow-sm hover:shadow transition-all flex flex-col"
              >
                <div className="relative h-28 bg-cream-50 flex items-center justify-center overflow-hidden">
                  {image ? (
                    <img
                      src={image}
                      alt={name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <span className="text-3xl">🎁</span>
                  )}

                  {price != null && (
                    <div className="absolute top-2 left-2 bg-gold text-charcoal text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">
                      {currency ?? "LKR"} {Number(price).toLocaleString()}
                    </div>
                  )}

                  {inStock === false && (
                    <div className="absolute inset-0 bg-charcoal/60 flex items-center justify-center">
                      <span className="text-white text-[10px] font-semibold uppercase tracking-wider">Out of stock</span>
                    </div>
                  )}
                </div>

                <div className="p-2.5 flex flex-col gap-1.5 flex-1">
                  <p className="text-xs font-medium leading-snug line-clamp-2 text-charcoal group-hover:text-teal transition-colors">
                    {name}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // prevent opening details
                      onAddToCart(product);
                    }}
                    disabled={inStock === false}
                    className="mt-auto w-full bg-cream-100 hover:bg-terracotta hover:text-white disabled:bg-cream-100 disabled:text-charcoal/20 text-charcoal/70 text-[10px] font-bold py-1.5 rounded-lg transition-colors"
                  >
                    Quick Add
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
