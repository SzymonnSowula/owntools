export function Logo({ size = 28, withWord = false }: { size?: number; withWord?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden
        className="shrink-0 drop-shadow-sm"
      >
        <defs>
          <linearGradient id="screeniMark" x1="8" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6B5BFF" />
            <stop offset="0.52" stopColor="#0E9A8A" />
            <stop offset="1" stopColor="#FF715F" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="url(#screeniMark)" />
        <rect x="14" y="16" width="36" height="26" rx="7" fill="#FFFCF8" />
        <path fill="#17151F" d="M38.2 36.2 44 48.8 47.4 41.4 54 40.2z" />
      </svg>
      {withWord ? (
        <span className="text-[17px] font-semibold tracking-[-0.04em] text-ink">screeni</span>
      ) : null}
    </div>
  );
}
