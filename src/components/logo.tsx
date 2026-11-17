export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect width="26" height="26" rx="7" fill="var(--accent)" />
        <circle cx="13" cy="13" r="5.5" fill="none" stroke="var(--accent-ink)" strokeWidth="2.4" />
        <circle cx="13" cy="13" r="1.8" fill="var(--accent-ink)" />
      </svg>
      {!compact && <span className="text-lg font-semibold tracking-tight">מרכז</span>}
    </span>
  );
}
