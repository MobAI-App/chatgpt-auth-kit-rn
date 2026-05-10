import { Credentials } from './credentials';
import { CredentialsProvider, StaticCredentialsProvider } from './credentialsProvider';

export interface Window {
  usedPercent: number;
  windowSeconds: number;
  resetAt: number;
}

export interface CreditsInfo {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface UsageStatus {
  planType: string | null;
  primary: Window | null;
  secondary: Window | null;
  credits: CreditsInfo | null;
  limitReachedKind: string | null;
}

export class UsageClient {
  private readonly provider: CredentialsProvider;

  constructor(
    providerOrCredentials: CredentialsProvider | Credentials,
    private readonly originator = 'codex_cli_rs',
  ) {
    this.provider =
      'currentCredentials' in providerOrCredentials
        ? providerOrCredentials
        : new StaticCredentialsProvider(providerOrCredentials);
  }

  async fetch(): Promise<UsageStatus> {
    const credentials = await this.provider.currentCredentials();
    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: 'application/json',
        originator: this.originator,
        ...(credentials.accountID ? { 'ChatGPT-Account-ID': credentials.accountID } : {}),
      },
    });
    if (res.status === 401) throw new Error('Token rejected - sign in again.');
    if (!res.ok) throw new Error(`Usage endpoint returned ${res.status}: ${await res.text()}`);
    return UsageClient.parse(await res.json());
  }

  static parse(json: any): UsageStatus {
    const window = (d: any): Window | null => {
      if (!d) return null;
      const used = typeof d.used_percent === 'number' ? d.used_percent : -1;
      const win = typeof d.limit_window_seconds === 'number' ? d.limit_window_seconds : -1;
      if (used < 0 || win < 0) return null;
      return { usedPercent: used, windowSeconds: win, resetAt: d.reset_at ?? 0 };
    };
    return {
      planType: (json.plan_type as string | undefined) ?? null,
      primary: window(json.rate_limit?.primary_window),
      secondary: window(json.rate_limit?.secondary_window),
      credits: json.credits
        ? {
            hasCredits: Boolean(json.credits.has_credits),
            unlimited: Boolean(json.credits.unlimited),
            balance: (json.credits.balance as string | undefined) ?? null,
          }
        : null,
      limitReachedKind: (json.rate_limit_reached_type?.kind as string | undefined) ?? null,
    };
  }
}
