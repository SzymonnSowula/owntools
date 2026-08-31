export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function defaultProjectName(date = new Date()): string {
  return `Recording ${date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
