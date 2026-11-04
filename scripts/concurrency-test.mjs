// 同時利用テスト: 在庫10の備品に対して30件の「使う」を同時に送り、在庫がマイナスにならないことを確認する
//   DATABASE_URL 未指定時はローカル Supabase（supabase start）の DB に接続
//   使い方: npm run test:concurrency
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DEVICE_KEY = 'concurrency-test-key';
const PARALLEL = 30;
const STOCK = 10;

const admin = new pg.Client({ connectionString: url });
await admin.connect();

let itemId, employeeId, oldHash;
try {
  oldHash = (await admin.query('select device_key_hash from public.app_settings where id')).rows[0].device_key_hash;
  await admin.query(`update public.app_settings set device_key_hash = extensions.crypt($1, extensions.gen_salt('bf', 4)) where id`, [DEVICE_KEY]);
  itemId = (await admin.query(
    `insert into public.items (name, unit, stock, threshold) values ('同時実行テスト備品', '個', $1, 0) returning id`, [STOCK])).rows[0].id;
  employeeId = (await admin.query(
    `insert into public.employees (employee_no, name) values ('CONC01', '同時 太郎') returning id`)).rows[0].id;

  const clients = await Promise.all(Array.from({ length: PARALLEL }, async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    return c;
  }));
  const results = await Promise.all(clients.map((c) =>
    c.query('select public.kiosk_use_items($1, $2, $3, $4::jsonb) as r',
      [DEVICE_KEY, randomUUID(), 'CONC01', JSON.stringify([{ item_id: Number(itemId), quantity: 1 }])])
      .then((res) => res.rows[0].r)));
  await Promise.all(clients.map((c) => c.end()));

  const ok = results.filter((r) => r.ok).length;
  const short = results.filter((r) => r.error === 'insufficient_stock').length;
  const stock = (await admin.query('select stock from public.items where id = $1', [itemId])).rows[0].stock;
  const usages = Number((await admin.query('select count(*) from public.usages where item_id = $1', [itemId])).rows[0].count);

  console.log({ parallel: PARALLEL, ok, insufficient: short, stock, usages });
  const pass = ok === STOCK && short === PARALLEL - STOCK && stock === 0 && usages === STOCK;
  console.log(pass ? 'PASS: 同時利用でも在庫はマイナスにならず、成功件数と履歴件数が一致' : 'FAIL');
  process.exitCode = pass ? 0 : 1;
} finally {
  if (itemId) {
    await admin.query(`delete from public.mail_outbox where ref_batch_id in (select batch_id from public.usages where item_id = $1)`, [itemId]);
    await admin.query(`delete from public.usages where item_id = $1`, [itemId]);
    await admin.query(`delete from public.usage_batches where employee_id = $1`, [employeeId]);
    await admin.query(`delete from public.reminder_log where item_id = $1`, [itemId]);
    await admin.query(`delete from public.items where id = $1`, [itemId]);
  }
  if (employeeId) await admin.query(`delete from public.employees where id = $1`, [employeeId]);
  await admin.query('update public.app_settings set device_key_hash = $1 where id', [oldHash]);
  await admin.end();
}
