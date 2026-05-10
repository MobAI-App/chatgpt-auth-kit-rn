import { Credentials } from './credentials';
import { CredentialsProvider, StaticCredentialsProvider } from './credentialsProvider';

export interface CodexModel {
  slug: string;
  displayName: string | null;
  isDefault: boolean;
}

export interface ModelsClientOptions {
  clientVersion?: string;
  originator?: string;
}

export class ModelsClient {
  private readonly provider: CredentialsProvider;

  constructor(
    providerOrCredentials: CredentialsProvider | Credentials,
    private readonly opts: ModelsClientOptions = {},
  ) {
    this.provider =
      'currentCredentials' in providerOrCredentials
        ? providerOrCredentials
        : new StaticCredentialsProvider(providerOrCredentials);
  }

  async fetch(): Promise<CodexModel[]> {
    const credentials = await this.provider.currentCredentials();
    const clientVersion = this.opts.clientVersion ?? 'chatgpt-auth-kit-rn-0.1';
    const url = `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: 'application/json',
        originator: this.opts.originator ?? 'codex_cli_rs',
        ...(credentials.accountID ? { 'ChatGPT-Account-ID': credentials.accountID } : {}),
      },
    });
    if (res.status === 401) throw new Error('Token rejected - sign in again.');
    if (!res.ok) throw new Error(`Models endpoint returned ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { models?: any[] };
    return (json.models ?? []).flatMap((m) => {
      const slug = (m.slug ?? m.model) as string | undefined;
      if (!slug) return [];
      return [
        {
          slug,
          displayName: (m.display_name as string | undefined) ?? (m.name as string | undefined) ?? null,
          isDefault: Boolean(m.is_default),
        },
      ];
    });
  }
}
