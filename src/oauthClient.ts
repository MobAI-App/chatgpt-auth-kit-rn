import { Credentials } from './credentials';

const AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPES = 'openid profile email offline_access';
const CALLBACK_PORT = 1455;

export const OAuthEndpoints = {
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  CLIENT_ID,
  REDIRECT_URI,
  SCOPES,
  CALLBACK_PORT,
};

export interface AuthorizationRequest {
  url: string;
  verifier: string;
  state: string;
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

function randomBytes(n: number): Uint8Array {
  // RN ships Math.random; for crypto we need react-native-get-random-values polyfill.
  // Consumer should `import 'react-native-get-random-values'` once at app entry.
  const a = new Uint8Array(n);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(a);
  } else {
    for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
  }
  return a;
}

function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  const b64 = typeof btoa === 'function' ? btoa(str) : Buffer.from(str, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input: string): Promise<Uint8Array> {
  // Modern RN versions have crypto.subtle behind a flag; fall back to a JS polyfill if missing.
  if (globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(input);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hash);
  }
  // Lazy fallback — pull in `js-sha256` if you don't have crypto.subtle.
  throw new OAuthError(
    "crypto.subtle.digest unavailable. Install 'react-native-quick-crypto' or polyfill SHA-256.",
  );
}

export const OAuthClient = {
  async buildAuthorizationURL(originator = 'codex_cli_rs'): Promise<AuthorizationRequest> {
    const verifier = base64UrlEncode(randomBytes(32));
    const challengeBytes = await sha256(verifier);
    const challenge = base64UrlEncode(challengeBytes);
    const state = base64UrlEncode(randomBytes(32));

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      codex_cli_simplified_flow: 'true',
      originator,
    });
    return { url: `${AUTH_ENDPOINT}?${params.toString()}`, verifier, state };
  },

  async exchangeCode(code: string, verifier: string): Promise<Credentials> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new OAuthError(`Token endpoint returned ${res.status}: ${text}`);
    return Credentials.fromTokenResponse(JSON.parse(text));
  },

  async refresh(creds: Credentials): Promise<Credentials> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: creds.refreshToken,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new OAuthError(`Token endpoint returned ${res.status}: ${text}`);
    const fresh = Credentials.fromTokenResponse(JSON.parse(text));
    return new Credentials(
      fresh.accessToken,
      fresh.refreshToken || creds.refreshToken,
      fresh.expiresAt,
      fresh.accountID || creds.accountID,
    );
  },
};
