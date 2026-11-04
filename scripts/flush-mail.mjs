// send-mail を手動で1回実行する（ローカル開発で pg_cron を待たずに送信したいとき）
//   使い方: MAIL_WORKER_SECRET=... npm run mail:flush
const url = process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1/send-mail';
const secret = process.env.MAIL_WORKER_SECRET;
if (!secret) {
  console.error('MAIL_WORKER_SECRET を指定してください（supabase/functions/.env と同じ値）');
  process.exit(1);
}
const res = await fetch(url, { method: 'POST', headers: { 'x-worker-secret': secret, 'Content-Type': 'application/json' }, body: '{}' });
console.log(res.status, await res.text());
