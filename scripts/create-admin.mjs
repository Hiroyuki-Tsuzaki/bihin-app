// 最初の管理者を作成する（2人目以降は管理画面の「管理者」から追加できる）
//   使い方: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-admin.mjs admin@example.com 'パスワード'
//   ローカル: `supabase status` で表示される API URL と service_role key（Secret key）を使う
import { createClient } from '@supabase/supabase-js';

const [email, password] = process.argv.slice(2);
const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !password || !key) {
  console.error('使い方: SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-admin.mjs <email> <password>');
  process.exit(1);
}
if (password.length < 10) {
  console.error('パスワードは10文字以上にしてください');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  console.error('ユーザー作成に失敗:', error.message);
  process.exit(1);
}
const { error: e2 } = await db.from('app_admins').insert({ user_id: data.user.id, email: email.toLowerCase() });
if (e2) {
  console.error('管理者登録に失敗:', e2.message);
  process.exit(1);
}
console.log(`管理者を作成しました: ${email}`);
