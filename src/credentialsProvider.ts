import { Credentials } from './credentials';
import type { CredentialsStore } from './credentialsStore';
import { OAuthClient } from './oauthClient';

/**
 * Source-of-truth for the access token used by the API clients
 * (`ResponsesClient`, `ModelsClient`, `UsageClient`).
 *
 * The default implementation, `RefreshingCredentialsProvider`, swaps in fresh
 * credentials from `OAuthClient.refresh` when the access token is about to
 * expire, and persists the result via `CredentialsStore`. Build one of those
 * at app start and hand it to every client; never store a bare `Credentials`
 * in long-lived state.
 */
export interface CredentialsProvider {
  /** Returns valid credentials, refreshing them first if they're stale. */
  currentCredentials(): Promise<Credentials>;
}

/**
 * Wraps a single `Credentials` value as a non-refreshing provider. Useful for
 * one-shot calls or tests; production callers should use
 * `RefreshingCredentialsProvider`.
 */
export class StaticCredentialsProvider implements CredentialsProvider {
  constructor(private readonly creds: Credentials) {}
  async currentCredentials(): Promise<Credentials> {
    return this.creds;
  }
}

export interface RefreshingCredentialsProviderOptions {
  /** Refresh the token when fewer than this many ms remain before expiry. */
  bufferMs?: number;
  /** Persist refreshed credentials here. */
  store?: typeof CredentialsStore;
  /** Override the refresh function (useful for tests). */
  refresh?: (current: Credentials) => Promise<Credentials>;
}

/**
 * Caches credentials and refreshes them via `OAuthClient.refresh` when
 * `Credentials.isExpired()` is true. Concurrent callers during a refresh share
 * a single in-flight refresh promise. Optionally writes the new credentials
 * back to a `CredentialsStore` so they survive app launches.
 */
export class RefreshingCredentialsProvider implements CredentialsProvider {
  private credentials: Credentials;
  private readonly bufferMs: number;
  private readonly store?: typeof CredentialsStore;
  private readonly refreshFn: (current: Credentials) => Promise<Credentials>;
  private inFlight: Promise<Credentials> | null = null;

  constructor(credentials: Credentials, opts: RefreshingCredentialsProviderOptions = {}) {
    this.credentials = credentials;
    this.bufferMs = opts.bufferMs ?? 5 * 60 * 1000;
    this.store = opts.store;
    this.refreshFn = opts.refresh ?? OAuthClient.refresh;
  }

  async currentCredentials(): Promise<Credentials> {
    if (!this.credentials.isExpired(this.bufferMs)) return this.credentials;
    if (this.inFlight) return this.inFlight;

    const current = this.credentials;
    const promise = (async () => {
      try {
        const fresh = await this.refreshFn(current);
        this.credentials = fresh;
        if (this.store) {
          try {
            await this.store.save(fresh);
          } catch {
            // best-effort persist; the in-memory copy is still updated.
          }
        }
        return fresh;
      } finally {
        this.inFlight = null;
      }
    })();
    this.inFlight = promise;
    return promise;
  }

  /** Replace the cached credentials (e.g. after a fresh sign-in) and persist. */
  async update(credentials: Credentials): Promise<void> {
    this.credentials = credentials;
    if (this.store) {
      try {
        await this.store.save(credentials);
      } catch {}
    }
  }
}
