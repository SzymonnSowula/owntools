const base = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 16,
  height: 16,
};

export function PauseIcon() {
  return (
    <svg {...base}>
      <path d="M5.5 3.5v9M10.5 3.5v9" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg {...base} fill="currentColor" stroke="none">
      <path d="M5 3.2v9.6L12.5 8z" />
    </svg>
  );
}

export function RestartIcon() {
  return (
    <svg {...base}>
      <path d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4" />
      <path d="M3 2.6v2.6h2.6" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...base}>
      <path d="M3 4.5h10M6.5 2.5h3M4.5 4.5l.6 8h5.8l.6-8M6.8 7v3.5M9.2 7v3.5" />
    </svg>
  );
}

export function DotsIcon() {
  return (
    <svg {...base} fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </svg>
  );
}

export function MicIcon({ muted }: { muted?: boolean }) {
  return (
    <svg {...base}>
      <rect x="5.75" y="2" width="4.5" height="7.5" rx="2.25" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2M6 14h4" />
      {muted ? <path d="M3 3l10 10" /> : null}
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg {...base}>
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg {...base}>
      <path d="M10 3.5 5.5 8 10 12.5" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg {...base} fill="currentColor" stroke="none">
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
    </svg>
  );
}
