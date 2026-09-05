import { isTauri } from "@core/env";
import { ProviderError } from "./types";

/**
 * OAuth 2.0 authorization-code flow (with PKCE where the network supports
 * it) for "bring your own app" networks. The browser is sent to the
 * network's consent page with a loopback redirect served by the Rust agent
 * server (`http://127.0.0.1:<port>/oauth/callback`), which hands the code
 * back to this window as the Tauri event `social-oauth-callback`.
 */

export const OAUTH_CALLBACK_EVENT = "social-oauth-callback";

export interface OAuthCallback {
  state: string;
  code?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}

export interface AgentInfo {
  running: boolean;
  enabled: boolean;
  port: number;
  token: string;
  url: string;
}

export async function agentInfo(): Promise<AgentInfo | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<AgentInfo>("social_agent_info");
  } catch {
    return null;
  }
}

export async function redirectUri(): Promise<string> {
  const info = await agentInfo();
  if (!info?.running) {
    throw new ProviderError(
      "The local callback server is not running — open the Agents page and check the server status.",
      false,
    );
  }
  return `http://127.0.0.1:${info.port}/oauth/callback`;
}

function randomString(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export interface AuthorizeRequest {
  authorizeUrl: string;
  clientId: string;
  scope: string;
  pkce: boolean;
  /** Extra query parameters the network wants. */
  extra?: Record<string, string>;
}

export interface AuthorizeResult {
  code: string;
  redirectUri: string;
  verifier: string | null;
}

/**
 * Opens the consent page and resolves with the code once the callback
 * arrives (or rejects after `timeoutMs`, on a denied consent, or outside the
 * desktop app).
 */
export async function authorize(req: AuthorizeRequest, onProgress?: (m: string) => void, timeoutMs = 5 * 60_000): Promise<AuthorizeResult> {
  if (!isTauri()) throw new ProviderError("OAuth sign-in needs the desktop app.", false);
  const redirect = await redirectUri();
  const state = randomString(16);
  const verifier = req.pkce ? randomString(48) : null;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: req.clientId,
    redirect_uri: redirect,
    scope: req.scope,
    state,
    ...(req.extra ?? {}),
  });
  if (verifier) {
    params.set("code_challenge", await pkceChallenge(verifier));
    params.set("code_challenge_method", "S256");
  }
  const url = `${req.authorizeUrl}${req.authorizeUrl.includes("?") ? "&" : "?"}${params.toString()}`;

  const { listen } = await import("@tauri-apps/api/event");
  const { openUrl } = await import("@tauri-apps/plugin-opener");

  return new Promise<AuthorizeResult>((resolve, reject) => {
    let unlisten: (() => void) | null = null;
    const timer = setTimeout(() => {
      unlisten?.();
      reject(new ProviderError("No answer from the browser in five minutes — try again.", false));
    }, timeoutMs);
    void listen<OAuthCallback>(OAUTH_CALLBACK_EVENT, (event) => {
      const cb = event.payload;
      if (!cb || cb.state !== state) return;
      clearTimeout(timer);
      unlisten?.();
      if (cb.error || !cb.code) {
        reject(new ProviderError(`Sign-in was not completed: ${cb.errorDescription || cb.error || "no code"}.`, false));
        return;
      }
      resolve({ code: cb.code, redirectUri: redirect, verifier });
    })
      .then((un) => {
        unlisten = un;
        onProgress?.("Waiting for you to approve the app in the browser…");
        return openUrl(url);
      })
      .catch((err) => {
        clearTimeout(timer);
        unlisten?.();
        reject(err);
      });
  });
}

/** Base64 "client_id:client_secret" for confidential clients. */
export function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}
