export const hasOpenRouter = () => !!process.env.OPENROUTER_API_KEY;
export const modelName = () => process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ToolSpec = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export async function chat(
  messages: ChatMessage[],
  opts: { tools?: ToolSpec[]; temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number } = {},
): Promise<{ content: string | null; toolCalls: ToolCall[]; model: string }> {
  if (!hasOpenRouter()) throw new Error('OPENROUTER_API_KEY is not set');
  const fallbacks = (process.env.OPENROUTER_FALLBACK_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const body: Record<string, unknown> = {
    model: modelName(),
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 900,
  };
  if (fallbacks.length) body.models = [modelName(), ...fallbacks];
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.json) body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        'X-Title': 'Route Scout',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 240)}`);
    const data = await res.json();
    const msg = data?.choices?.[0]?.message || {};
    return { content: msg.content ?? null, toolCalls: msg.tool_calls || [], model: data?.model || modelName() };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first JSON object out of a model reply (handles code fences and chatter). */
export function parseJson<T = any>(text: string | null): T | null {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
