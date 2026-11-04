// 管理者アカウントの一覧・追加・削除（管理者のみ実行可）
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight, requireEnv } from '../_shared/http.ts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ ok: false, error: 'unauthorized' }, 401);

  const url = requireEnv('SUPABASE_URL');
  const userDb = createClient(url, requireEnv('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: me } = await userDb.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  const { data: isAdmin } = await userDb.rpc('is_admin');
  if (!me.user || isAdmin !== true) return json({ ok: false, error: 'forbidden', message: '管理者権限がありません' }, 403);

  const service = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  let body: { action?: string; email?: string; password?: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  try {
    switch (body.action) {
      case 'list': {
        const { data, error } = await service.from('app_admins').select('user_id, email, created_at').order('created_at');
        if (error) throw error;
        return json({ ok: true, admins: data, me: me.user.id });
      }
      case 'create': {
        const email = (body.email ?? '').trim().toLowerCase();
        const password = body.password ?? '';
        if (!EMAIL_RE.test(email)) return json({ ok: false, message: 'メールアドレスの形式が正しくありません' }, 400);
        if (password.length < 10) return json({ ok: false, message: '初期パスワードは10文字以上にしてください' }, 400);
        const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) return json({ ok: false, message: `ユーザー作成に失敗しました: ${error.message}` }, 400);
        const { error: e2 } = await service.from('app_admins').insert({ user_id: data.user.id, email });
        if (e2) {
          await service.auth.admin.deleteUser(data.user.id);
          throw e2;
        }
        return json({ ok: true, user_id: data.user.id, email });
      }
      case 'delete': {
        if (!body.user_id) return json({ ok: false, message: 'user_id が必要です' }, 400);
        if (body.user_id === me.user.id) return json({ ok: false, message: '自分自身は削除できません' }, 400);
        const { count } = await service.from('app_admins').select('*', { count: 'exact', head: true });
        if ((count ?? 0) <= 1) return json({ ok: false, message: '最後の管理者は削除できません' }, 400);
        const { error } = await service.auth.admin.deleteUser(body.user_id);
        if (error) throw error;
        return json({ ok: true });
      }
      default:
        return json({ ok: false, error: 'bad_request', message: 'action は list / create / delete のいずれか' }, 400);
    }
  } catch (e) {
    console.error('[admin-users]', e);
    return json({ ok: false, message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
