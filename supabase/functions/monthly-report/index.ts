// 管理画面の「レポート生成」ボタンから呼ばれる：月次集計 + Claude による報告文生成
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callClaudeText, DEFAULT_CLAUDE_MODEL } from '../_shared/claude.ts';
import { json, preflight, requireEnv } from '../_shared/http.ts';
import { buildReportPrompt, isValidMonth, type MonthlyStats } from './report.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ ok: false, error: 'unauthorized' }, 401);

  let month: unknown;
  try {
    month = (await req.json()).month;
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  if (!isValidMonth(month)) return json({ ok: false, error: 'bad_request', message: 'month は YYYY-MM 形式で指定してください' }, 400);

  try {
    // ログイン中の管理者の権限で DB を操作（RLS / 関数内の管理者チェックが効く）
    const db = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData } = await db.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
    const { data: stats, error } = await db.rpc('admin_monthly_summary', { p_month: `${month}-01` });
    if (error) {
      return json({ ok: false, error: 'forbidden', message: error.message }, error.code === '42501' ? 403 : 400);
    }

    const model = Deno.env.get('CLAUDE_MODEL') ?? DEFAULT_CLAUDE_MODEL;
    const { system, user } = buildReportPrompt(stats as MonthlyStats);
    const content = await callClaudeText({ apiKey: requireEnv('ANTHROPIC_API_KEY'), model, system, user, maxTokens: 2000 });

    const { data: saved, error: insertError } = await db.from('monthly_reports').insert({
      target_month: `${month}-01`,
      content,
      stats,
      model,
      created_by: userData.user?.id ?? null,
      created_by_email: userData.user?.email ?? null,
    }).select('id, created_at').single();
    if (insertError) throw insertError;

    return json({ ok: true, id: saved.id, created_at: saved.created_at, content, stats, model });
  } catch (e) {
    console.error('[monthly-report]', e);
    return json({ ok: false, error: 'report_failed', message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
