// Claude API（Messages API）呼び出し
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';

export interface ClaudeOptions {
  apiKey: string;
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

async function post(opts: ClaudeOptions, extra: Record<string, unknown>) {
  const f = opts.fetchImpl ?? fetch;
  const res = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
      ...extra,
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude API エラー (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  return await res.json() as { content: Array<{ type: string; text?: string; input?: unknown }> };
}

/** ツール呼び出しを強制して構造化データを受け取る */
export async function callClaudeTool<T>(opts: ClaudeOptions, tool: ClaudeTool): Promise<T> {
  const data = await post(opts, { tools: [tool], tool_choice: { type: 'tool', name: tool.name } });
  const block = data.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('Claude API から構造化データが返りませんでした');
  return block.input as T;
}

/** 文章を生成する */
export async function callClaudeText(opts: ClaudeOptions): Promise<string> {
  const data = await post(opts, {});
  return data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
}
