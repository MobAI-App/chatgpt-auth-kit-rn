import { Credentials } from './credentials';
import { CredentialsProvider, StaticCredentialsProvider } from './credentialsProvider';

export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ResponseEvent =
  | { type: 'delta'; text: string }
  | { type: 'completed'; usage: Usage | null };

export class ResponsesClientError extends Error {}

export interface ResponsesConfig {
  endpoint?: string;
  model?: string;
  instructionsFallback?: string;
  reasoningEffort?: string;
  originator?: string;
}

const DEFAULT_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

export class ResponsesClient {
  private readonly provider: CredentialsProvider;

  constructor(
    providerOrCredentials: CredentialsProvider | Credentials,
    private readonly config: ResponsesConfig = {},
  ) {
    this.provider =
      'currentCredentials' in providerOrCredentials
        ? providerOrCredentials
        : new StaticCredentialsProvider(providerOrCredentials);
  }

  /** Streams ResponseEvents using async iteration. */
  async *stream(messages: Message[]): AsyncGenerator<ResponseEvent, void, void> {
    const credentials = await this.provider.currentCredentials();
    const cfg = this.config;
    const body = this.buildBody(messages);

    const res = await fetch(cfg.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.accessToken}`,
        'OpenAI-Beta': 'responses=experimental',
        originator: cfg.originator ?? 'codex_cli_rs',
        Accept: 'text/event-stream',
        ...(credentials.accountID ? { 'ChatGPT-Account-ID': credentials.accountID } : {}),
      },
      body: JSON.stringify(body),
      // @ts-ignore - RN's fetch supports streaming since ~0.74 with the BlobResponse polyfill.
      reactNative: { textStreaming: true },
    });

    if (res.status === 401) throw new ResponsesClientError('ChatGPT authentication failed - sign in again.');
    if (res.status === 429) {
      const retry = res.headers.get('x-codex-primary-reset-after-seconds');
      throw new ResponsesClientError(`Rate limit hit${retry ? `. Retry in ${retry}s` : ''}.`);
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new ResponsesClientError(`ChatGPT API error ${res.status}: ${txt}`);
    }

    if (!res.body) throw new ResponsesClientError('Streaming body unavailable.');
    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        switch (json.type) {
          case 'response.output_text.delta':
            if (typeof json.delta === 'string' && json.delta) yield { type: 'delta', text: json.delta };
            break;
          case 'response.completed': {
            const u = json.response?.usage;
            yield {
              type: 'completed',
              usage: u
                ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, totalTokens: u.total_tokens ?? 0 }
                : null,
            };
            break;
          }
        }
      }
    }
  }

  /** Convenience: collect the full text + final usage in one call. */
  async complete(messages: Message[]): Promise<{ text: string; usage: Usage | null }> {
    let text = '';
    let usage: Usage | null = null;
    for await (const event of this.stream(messages)) {
      if (event.type === 'delta') text += event.text;
      if (event.type === 'completed') usage = event.usage;
    }
    return { text, usage };
  }

  private buildBody(messages: Message[]): Record<string, unknown> {
    const { instructions, input } = ResponsesClient.buildInput(messages);
    return {
      model: this.config.model ?? 'gpt-5.5',
      store: false,
      stream: true,
      input,
      instructions: instructions || (this.config.instructionsFallback ?? "Follow the user's instructions."),
      reasoning: { effort: this.config.reasoningEffort ?? 'medium', summary: 'auto' },
      include: ['reasoning.encrypted_content'],
    };
  }

  private static buildInput(messages: Message[]): { instructions: string; input: any[] } {
    let instructions = '';
    const input: any[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        instructions = instructions ? `${instructions}\n\n${m.content}` : m.content;
      } else {
        input.push({
          type: 'message',
          role: m.role,
          content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
        });
      }
    }
    return { instructions, input };
  }
}
