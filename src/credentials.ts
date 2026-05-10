import { extractAccountID, extractPlanType } from './jwt';

export interface CredentialsJSON {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix millis
  accountID: string;
}

export class Credentials {
  constructor(
    public accessToken: string,
    public refreshToken: string,
    public expiresAt: Date,
    public accountID: string,
  ) {}

  isExpired(bufferMs: number = 5 * 60 * 1000): boolean {
    return this.expiresAt.getTime() - Date.now() <= bufferMs;
  }

  get planType(): string | null {
    return extractPlanType(this.accessToken);
  }

  toJSON(): CredentialsJSON {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt.getTime(),
      accountID: this.accountID,
    };
  }

  static fromJSON(j: CredentialsJSON): Credentials {
    return new Credentials(j.accessToken, j.refreshToken, new Date(j.expiresAt), j.accountID);
  }

  static fromTokenResponse(json: any): Credentials {
    const access = json.access_token as string;
    const refresh = (json.refresh_token as string) ?? '';
    const expiresIn = json.expires_in as number;
    return new Credentials(
      access,
      refresh,
      new Date(Date.now() + expiresIn * 1000),
      extractAccountID(access) ?? '',
    );
  }
}
