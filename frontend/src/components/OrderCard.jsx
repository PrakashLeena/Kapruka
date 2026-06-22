export default function OrderCard({ order }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gold bg-cream-100 p-4 flex flex-col gap-2 max-w-xs">
      <div className="flex items-center gap-2 text-teal">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-semibold">Order ready</span>
      </div>

      {order.orderNumber && (
        <p className="text-xs text-charcoal/60">Order #{order.orderNumber}</p>
      )}

      {order.total != null && (
        <p className="text-lg font-display">
          {order.currency} {Number(order.total).toLocaleString()}
        </p>
      )}

      <a
        href={order.payUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-1 text-center bg-terracotta hover:bg-terracotta-dark text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
      >
        Complete payment
      </a>
      <p className="text-[11px] text-charcoal/50 text-center">
        Guest checkout - no Kapruka account needed. Price locked for 60 minutes.
      </p>
    </div>
  );
}
