/**
 * Minimal HTTP/1.1 server bound to 127.0.0.1:port that resolves the first
 * `/auth/callback` request with its query parameters.
 *
 * Implementation notes for React Native:
 *  - Uses `react-native-tcp-socket` to open a raw TCP listener.
 *  - Parses the HTTP request manually (`\r\n\r\n` is the header terminator).
 *  - Binds IPv4 only by default. Some browsers on iOS resolve `localhost` to
 *    `::1` first — for SFSafariViewController this is usually fine because
 *    the system retries IPv4. If you hit issues, also call
 *    `TcpSocket.createServer` against `::` and listen in parallel.
 */
import TcpSocket from 'react-native-tcp-socket';

export interface LoopbackOptions {
  port: number;
  host?: string;
}

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Done</title>
<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:40px;color:#222}h2{color:#10a37f}</style>
</head><body>
<h2>Authentication successful</h2>
<p>You can close this tab and return to the app.</p>
</body></html>`;

export class LoopbackServer {
  readonly port: number;
  readonly host: string;
  private server: any | null = null;
  private resolve!: (value: Record<string, string>) => void;
  private reject!: (reason: Error) => void;
  private finished = false;
  private callbackPromise: Promise<Record<string, string>>;

  constructor(opts: LoopbackOptions) {
    this.port = opts.port;
    this.host = opts.host ?? '127.0.0.1';
    this.callbackPromise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  /**
   * Binds the listener. Resolves on the `'listening'` event, or — as a fallback
   * for `react-native-tcp-socket` versions that emit the event synchronously
   * during `listen()` (before our handler is attached) — after a short delay.
   * After this future resolves it's safe to direct the browser at
   * `http://localhost:<port>/auth/callback`.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        this.server = TcpSocket.createServer((socket: any) => {
          let buf = '';
          socket.on('data', (chunk: any) => {
            buf += String(chunk);
            if (buf.includes('\r\n\r\n')) this.handleRequest(socket, buf);
          });
          socket.on('error', () => socket.destroy());
        });
        this.server.on('error', (err: Error) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
          this.finish(undefined, err);
        });
        this.server.on('listening', settle);
        this.server.listen({ port: this.port, host: this.host });
        // Fallback: `'listening'` is unreliable across react-native-tcp-socket
        // versions. Assume bind has completed after a short delay if the event
        // hasn't fired — any actual bind error fires on `'error'` first.
        setTimeout(settle, 300);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.finish(undefined, err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });
  }

  /** Suspends until an `/auth/callback` request lands or `stop()` is called. */
  waitForCallback(): Promise<Record<string, string>> {
    return this.callbackPromise;
  }

  stop(): void {
    if (!this.finished && this.server) {
      this.finished = true;
      try {
        this.reject(new Error('Loopback server stopped.'));
      } catch {}
    }
    if (this.server) {
      try {
        this.server.close();
      } catch {}
      this.server = null;
    }
  }

  private handleRequest(socket: any, raw: string): void {
    const firstLine = raw.split('\r\n')[0] ?? '';
    const [method, path = ''] = firstLine.split(' ');
    if (method !== 'GET') {
      this.respondAndClose(socket, '405 Method Not Allowed', 'Method not allowed');
      return;
    }
    if (!path.startsWith('/auth/callback')) {
      this.respondAndClose(socket, '404 Not Found', 'Not found');
      return;
    }
    const query = LoopbackServer.parseQuery(path);
    this.respondAndClose(socket, '200 OK', SUCCESS_HTML, 'text/html; charset=utf-8');
    this.finish(query);
  }

  static parseQuery(path: string): Record<string, string> {
    const i = path.indexOf('?');
    if (i < 0) return {};
    const out: Record<string, string> = {};
    for (const pair of path.slice(i + 1).split('&')) {
      const [k, v = ''] = pair.split('=');
      out[decodeURIComponent(k)] = decodeURIComponent(v);
    }
    return out;
  }

  private respondAndClose(
    socket: any,
    status: string,
    body: string,
    contentType = 'text/plain; charset=utf-8',
  ): void {
    // Use TextEncoder (available in Hermes / modern JS) instead of Node's
    // Buffer so the lib doesn't require a `buffer` polyfill in RN.
    const byteLength = new TextEncoder().encode(body).length;
    const header =
      `HTTP/1.1 ${status}\r\n` +
      `Content-Type: ${contentType}\r\n` +
      `Content-Length: ${byteLength}\r\n` +
      `Connection: close\r\n\r\n`;
    socket.write(header + body);
    setTimeout(() => socket.destroy(), 100);
  }

  private finish(query?: Record<string, string>, err?: Error): void {
    if (this.finished) return;
    this.finished = true;
    if (this.server) {
      try {
        this.server.close();
      } catch {}
      this.server = null;
    }
    if (err) this.reject(err);
    else if (query) this.resolve(query);
  }
}
