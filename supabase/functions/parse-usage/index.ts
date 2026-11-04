// 利用端末から呼ばれる：自然文を備品と数量に変換する（登録はしない。確認画面で確定後に kiosk_use_items を呼ぶ）
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callClaudeTool, DEFAULT_CLAUDE_MODEL } from '../_shared/claude.ts';
import { clientIp, json, preflight, requireEnv } from '../_shared/http.ts';
import { buildParsePrompt, type KioskItem, MAX_TEXT_LENGTH, normalizeParseResult, PARSE_TOOL } from './parse.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body: { device_key?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request', message: 'リクエストが不正です' }, 400);
  }
  const text = (body.text ?? '').trim();
  if (!text) return json({ ok: false, error: 'empty_text', message: '受け取る備品と数量を入力してください' }, 400);
  if (text.length > MAX_TEXT_LENGTH) {
    return json({ ok: false, error: 'text_too_long', message: `${MAX_TEXT_LENGTH}文字以内で入力してください` }, 400);
  }

  try {
    // 端末キーの検証と備品一覧の取得を兼ねる（呼び出し元IPを引き継いで総当たり対策を効かせる）
    const ip = clientIp(req);
    const db = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false },
      global: { headers: ip ? { 'x-forwarded-for': ip } : {} },
    });
    const { data, error } = await db.rpc('kiosk_list_items', { p_device_key: body.device_key ?? '' });
    if (error) throw error;
    if (!data?.ok) return json(data, 401);
    const items = data.items as KioskItem[];

    const { system, user } = buildParsePrompt(text, items);
    const raw = await callClaudeTool(
      {
        apiKey: requireEnv('ANTHROPIC_API_KEY'),
        model: Deno.env.get('CLAUDE_MODEL') ?? DEFAULT_CLAUDE_MODEL,
        system,
        user,
        maxTokens: 1024,
      },
      PARSE_TOOL,
    );
    return json({ ok: true, ...normalizeParseResult(raw, items) });
  } catch (e) {
    console.error('[parse-usage]', e);
    return json({ ok: false, error: 'parse_failed', message: 'AIによる解析に失敗しました。備品一覧から選んで登録してください。' }, 502);
  }
});
