import {
  Credentials,
  extractAccountID,
  extractPlanType,
  LoopbackServer,
  RefreshingCredentialsProvider,
  UsageClient,
} from '../src';

function b64UrlNoPad(s: string): string {
  return Buffer.from(s, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeJwt(payload: Record<string, unknown>): string {
  return `header.${b64UrlNoPad(JSON.stringify(payload))}.sig`;
}

describe('Credentials', () => {
  test('expiry boundary respects buffer', () => {
    const c = new Credentials('x', 'y', new Date(Date.now() + 60_000), 'z');
    expect(c.isExpired(120_000)).toBe(true);
    expect(c.isExpired(30_000)).toBe(false);
  });

  test('round-trips through JSON', () => {
    const c = new Credentials('a', 'b', new Date(1700000000000), 'acc_x');
    const back = Credentials.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    expect(back.accessToken).toBe('a');
    expect(back.accountID).toBe('acc_x');
    expect(back.expiresAt.getTime()).toBe(1700000000000);
  });
});

describe('JWT', () => {
  test('extracts account id from auth claim', () => {
    const t = makeJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acc_111',
        chatgpt_plan_type: 'plus',
      },
    });
    expect(extractAccountID(t)).toBe('acc_111');
    expect(extractPlanType(t)).toBe('plus');
  });

  test('falls back to top-level claim', () => {
    const t = makeJwt({ chatgpt_account_id: 'acc_222', chatgpt_plan_type: 'pro' });
    expect(extractAccountID(t)).toBe('acc_222');
    expect(extractPlanType(t)).toBe('pro');
  });

  test('falls back to organizations[0].id', () => {
    const t = makeJwt({ organizations: [{ id: 'org_333' }] });
    expect(extractAccountID(t)).toBe('org_333');
    expect(extractPlanType(t)).toBeNull();
  });

  test('returns null for malformed tokens', () => {
    expect(extractAccountID('not.a.jwt')).toBeNull();
    expect(extractAccountID('two.parts')).toBeNull();
    expect(extractAccountID('')).toBeNull();
  });
});

describe('UsageClient.parse', () => {
  test('decodes a full payload', () => {
    const s = UsageClient.parse({
      plan_type: 'plus',
      rate_limit: {
        primary_window: { used_percent: 12.5, limit_window_seconds: 18000, reset_at: 9999 },
        secondary_window: { used_percent: 4, limit_window_seconds: 604800, reset_at: 11111 },
      },
      credits: { has_credits: true, unlimited: false, balance: '9.99' },
      rate_limit_reached_type: { kind: 'credit_depleted' },
    });
    expect(s.planType).toBe('plus');
    expect(s.primary?.usedPercent).toBe(12.5);
    expect(s.primary?.windowSeconds).toBe(18000);
    expect(s.secondary?.usedPercent).toBe(4);
    expect(s.credits?.balance).toBe('9.99');
    expect(s.limitReachedKind).toBe('credit_depleted');
  });

  test('tolerates missing fields', () => {
    const s = UsageClient.parse({ plan_type: 'free' });
    expect(s.planType).toBe('free');
    expect(s.primary).toBeNull();
    expect(s.secondary).toBeNull();
    expect(s.credits).toBeNull();
    expect(s.limitReachedKind).toBeNull();
  });
});

describe('LoopbackServer.parseQuery', () => {
  test('parses a basic query string', () => {
    const q = LoopbackServer.parseQuery('/auth/callback?code=abc&state=xyz');
    expect(q.code).toBe('abc');
    expect(q.state).toBe('xyz');
  });

  test('decodes percent-encoded values', () => {
    const q = LoopbackServer.parseQuery('/auth/callback?error=access_denied&error_description=user%20cancelled');
    expect(q.error).toBe('access_denied');
    expect(q.error_description).toBe('user cancelled');
  });

  test('returns empty when no query', () => {
    expect(LoopbackServer.parseQuery('/auth/callback')).toEqual({});
  });
});

describe('RefreshingCredentialsProvider', () => {
  const fresh = new Credentials('ok', 'r', new Date(Date.now() + 3600_000), 'a');
  const stale = new Credentials('old', 'r', new Date(Date.now() - 60_000), 'a');
  const refreshed = new Credentials('new', 'r2', new Date(Date.now() + 3600_000), 'a');

  test('returns cached credentials when fresh', async () => {
    const provider = new RefreshingCredentialsProvider(fresh, {
      refresh: async () => {
        throw new Error('refresh should not be called when token is fresh');
      },
    });
    expect((await provider.currentCredentials()).accessToken).toBe('ok');
  });

  test('refreshes when expired', async () => {
    const provider = new RefreshingCredentialsProvider(stale, {
      refresh: async () => refreshed,
    });
    const c = await provider.currentCredentials();
    expect(c.accessToken).toBe('new');
    expect(c.refreshToken).toBe('r2');
  });

  test('coalesces concurrent refreshes', async () => {
    let calls = 0;
    const provider = new RefreshingCredentialsProvider(stale, {
      refresh: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 50));
        return refreshed;
      },
    });
    const results = await Promise.all([
      provider.currentCredentials(),
      provider.currentCredentials(),
      provider.currentCredentials(),
    ]);
    expect(results.map((c) => c.accessToken)).toEqual(['new', 'new', 'new']);
    expect(calls).toBe(1);
  });

  test('propagates refresh failure', async () => {
    const provider = new RefreshingCredentialsProvider(stale, {
      refresh: async () => {
        throw new Error('boom');
      },
    });
    await expect(provider.currentCredentials()).rejects.toThrow('boom');
  });
});
