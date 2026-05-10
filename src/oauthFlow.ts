import InAppBrowser from 'react-native-inappbrowser-reborn';

import { Credentials } from './credentials';
import { LoopbackServer } from './loopbackServer';
import { OAuthClient, OAuthError, OAuthEndpoints } from './oauthClient';

export interface OAuthFlowOptions {
  originator?: string;
  timeoutMs?: number;
  /** Custom URL presenter; defaults to react-native-inappbrowser-reborn (SFSafariViewController on iOS, Chrome Custom Tabs on Android). */
  present?: (url: string) => Promise<void>;
  /** Called after the callback lands, regardless of success. Use to dismiss the browser sheet. */
  onComplete?: () => Promise<void> | void;
}

export const OAuthFlow = {
  /**
   * Runs the full OAuth login flow.
   * Returns a {@link Credentials} object on success.
   */
  async run(opts: OAuthFlowOptions = {}): Promise<Credentials> {
    const originator = opts.originator ?? 'codex_cli_rs';
    const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

    const request = await OAuthClient.buildAuthorizationURL(originator);
    const server = new LoopbackServer({ port: OAuthEndpoints.CALLBACK_PORT });
    await server.start();

    if (opts.present) {
      await opts.present(request.url);
    } else {
      if (await InAppBrowser.isAvailable()) {
        InAppBrowser.open(request.url);
      } else {
        server.stop();
        throw new OAuthError('No browser available. Provide opts.present.');
      }
    }

    let query: Record<string, string>;
    try {
      query = await Promise.race([
        server.waitForCallback(),
        new Promise<Record<string, string>>((_, reject) =>
          setTimeout(() => {
            server.stop();
            reject(new OAuthError('Login timed out.'));
          }, timeoutMs),
        ),
      ]);
    } finally {
      server.stop();
      try {
        if (typeof InAppBrowser?.close === 'function') InAppBrowser.close();
      } catch {}
      if (opts.onComplete) await opts.onComplete();
    }

    if (query.error) {
      throw new OAuthError(
        `Provider rejected: ${query.error}${query.error_description ? ' - ' + query.error_description : ''}`,
      );
    }
    if (query.state !== request.state) throw new OAuthError('OAuth state mismatch.');
    if (!query.code) throw new OAuthError('Authorization code missing from callback.');

    return OAuthClient.exchangeCode(query.code, request.verifier);
  },
};
