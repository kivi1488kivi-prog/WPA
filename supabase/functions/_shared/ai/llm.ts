/** OpenAI-compatible Chat Completions client (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL). */
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ChatRequest {
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: 'auto' | 'none';
  max_tokens?: number;
}
export interface ChatResponse { message: ChatMessage; totalTokens: number }
export interface LlmClient { chat(req: ChatRequest): Promise<ChatResponse> }

export class LlmUnavailable extends Error {}

export function openAiCompatible(cfg: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number; fetchImpl?: typeof fetch }): LlmClient {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  return {
    async chat(req) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 25_000);
      try {
        const res = await (cfg.fetchImpl ?? fetch)(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model: cfg.model, temperature: 0.2, ...req }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new LlmUnavailable(`LLM HTTP ${res.status}`);
        const data = (await res.json()) as { choices?: { message?: ChatMessage }[]; usage?: { total_tokens?: number } };
        const message = data.choices?.[0]?.message;
        if (!message) throw new LlmUnavailable('LLM returned no message');
        return { message: { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls }, totalTokens: data.usage?.total_tokens ?? 0 };
      } catch (e) {
        if (e instanceof LlmUnavailable) throw e;
        throw new LlmUnavailable((e as Error).message);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
