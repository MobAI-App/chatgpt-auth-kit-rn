## 0.1.0

Initial release.

- `OAuthFlow` + `LoopbackServer`: PKCE flow with a localhost:1455 callback,
  awaits the TCP server's `'listening'` event before launching the browser.
- `CredentialsStore`: `react-native-keychain`-backed persistence.
- `RefreshingCredentialsProvider`: caches credentials, refreshes via
  `OAuthClient.refresh` when near-expiry, coalesces concurrent refreshes,
  persists to the store.
- `ResponsesClient` / `ModelsClient` / `UsageClient`: minimal hand-rolled
  REST/SSE clients pointed at `chatgpt.com/backend-api/codex`.
- 15 tests covering Credentials JSON round-trip, JWT decode, Usage parse,
  the loopback query parser, and the refreshing provider's caching /
  refresh / coalesce / failure paths.
