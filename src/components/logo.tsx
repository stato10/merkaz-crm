export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="var(--brand)" />
        <circle cx="12" cy="12" r="5" fill="none" stroke="#fff" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="1.6" fill="#fff" />
      </svg>
      {!compact && <span className="text-xl font-medium text-accent">מרכז</span>}
    </span>
  );
}
