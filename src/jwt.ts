/** Decodes JWT payload and extracts OpenAI-specific claims. */

function decodePayload(token: string): Record<string, any> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = payload.length % 4;
  if (pad > 0) payload += '='.repeat(4 - pad);
  try {
    // RN doesn't ship `atob` reliably across versions; fall back via Buffer if available.
    const decoded = typeof atob === 'function' ? atob(payload) : Buffer.from(payload, 'base64').toString('binary');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function extractAccountID(token: string): string | null {
  const json = decodePayload(token);
  if (!json) return null;
  const auth = json['https://api.openai.com/auth'];
  if (auth && typeof auth.chatgpt_account_id === 'string' && auth.chatgpt_account_id) {
    return auth.chatgpt_account_id;
  }
  if (typeof json.chatgpt_account_id === 'string' && json.chatgpt_account_id) {
    return json.chatgpt_account_id;
  }
  if (Array.isArray(json.organizations) && json.organizations[0]?.id) {
    return String(json.organizations[0].id);
  }
  return null;
}

export function extractPlanType(token: string): string | null {
  const json = decodePayload(token);
  if (!json) return null;
  const auth = json['https://api.openai.com/auth'];
  if (auth && typeof auth.chatgpt_plan_type === 'string' && auth.chatgpt_plan_type) {
    return auth.chatgpt_plan_type;
  }
  if (typeof json.chatgpt_plan_type === 'string' && json.chatgpt_plan_type) {
    return json.chatgpt_plan_type;
  }
  return null;
}
