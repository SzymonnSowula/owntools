/**
 * What the two Polar scripts share: reading web/.env.local, one small API
 * client, and printing. Runs on Node's built-in type stripping (Node >= 22.18 /
 * 23.6), so it sticks to erasable TypeScript - no enums, no parameter
 * properties.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WEB_ENV_FILE = join(ROOT, "web", ".env.local");

const BASES = {
  production: "https://api.polar.sh",
  sandbox: "https://sandbox-api.polar.sh",
} as const;

/* ------------------------------ environment ----------------------------- */

function parseEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const fileEnv = parseEnvFile(WEB_ENV_FILE);

/** A setting from the shell first, then web/.env.local. Empty counts as unset. */
export function setting(name: string): string | undefined {
  const value = process.env[name]?.trim() || fileEnv[name]?.trim();
  return value ? value : undefined;
}

/** Appends KEY=value to web/.env.local (creating it), unless the key is already there. */
export function appendToWebEnv(name: string, value: string, comment: string): void {
  const current = existsSync(WEB_ENV_FILE) ? readFileSync(WEB_ENV_FILE, "utf8") : "";
  // [ \t] rather than \s: \s would run across the line break into the next variable
  if (new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*\\S`, "m").test(current)) return;
  const withoutEmpty = current.replace(new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*(\\r?\\n|$)`, "m"), "");
  const sep = withoutEmpty === "" || withoutEmpty.endsWith("\n") ? "" : "\n";
  writeFileSync(WEB_ENV_FILE, `${withoutEmpty}${sep}# ${comment}\n${name}=${value}\n`);
  fileEnv[name] = value;
}

/* --------------------------------- client -------------------------------- */

export class PolarApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, what: string) {
    super(`${what} → ${status}${describeBody(body)}`);
    this.name = "PolarApiError";
    this.status = status;
    this.body = body;
  }
}

function describeBody(body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return `: ${detail}`;
  if (Array.isArray(detail)) {
    return `: ${detail
      .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).join(".")} ${d.msg ?? ""}`.trim())
      .join("; ")}`;
  }
  return body ? `: ${JSON.stringify(body).slice(0, 300)}` : "";
}

export interface Polar {
  server: keyof typeof BASES;
  base: string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

export interface Page<T> {
  items: T[];
  pagination: { total_count: number; max_page: number };
}

export function connect(options: { sandbox?: boolean } = {}): Polar {
  const token = setting("POLAR_ACCESS_TOKEN");
  if (!token) {
    fail(
      "POLAR_ACCESS_TOKEN is not set.",
      "Create one in the Polar dashboard → Settings → Developers → New token (for the sandbox,",
      "do it on sandbox.polar.sh), then put it in web/.env.local:",
      "",
      "    POLAR_ACCESS_TOKEN=polar_oat_…",
      "",
      "Scopes: organizations:read, products:read, products:write, benefits:read, benefits:write,",
      "files:write, discounts:read, discounts:write, checkouts:read, checkouts:write, orders:read,",
      "customers:read.",
    );
  }
  const server = options.sandbox || setting("POLAR_SERVER") === "sandbox" ? "sandbox" : "production";
  const base = (setting("POLAR_API_URL") ?? BASES[server]).replace(/\/+$/, "");

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (res.status === 401) {
      fail(
        `Polar refused the token (401) on ${server}.`,
        server === "production"
          ? "A sandbox token only works with --sandbox, and an expired or revoked one not at all."
          : "Sandbox tokens come from sandbox.polar.sh; a production token does not work there.",
      );
    }
    if (!res.ok) throw new PolarApiError(res.status, data, `${method} ${path.split("?")[0]}`);
    return data as T;
  };

  return {
    server,
    base,
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
  };
}

/** Every item of a list endpoint (100 per page). */
export async function listAll<T>(polar: Polar, path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= 50; page++) {
    const res = await polar.get<Page<T>>(`${path}${sep}limit=100&page=${page}`);
    out.push(...res.items);
    if (page >= res.pagination.max_page) break;
  }
  return out;
}

/* --------------------------------- output -------------------------------- */

const tty = process.stdout.isTTY;
const paint = (code: string) => (text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
export const dim = paint("2");
export const bold = paint("1");
export const green = paint("32");
export const yellow = paint("33");
export const red = paint("31");

export function fail(...lines: string[]): never {
  console.error(`\n${red("✗")} ${lines[0]}`);
  for (const line of lines.slice(1)) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
}

export function warn(line: string): void {
  console.log(`  ${yellow("!")} ${line}`);
}

export function money(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
