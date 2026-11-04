-- 備品の使用（受取）に関するテスト
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- ---- テストデータ（seed の影響を受けないよう既存備品は無効化） ----
update public.items set is_active = false;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.com');
insert into public.app_admins (user_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.com');
insert into public.account_titles (name) values ('テスト仕訳');
insert into public.items (name, unit, stock, threshold, unit_price, account_title_id) values
  ('テスト用紙', '冊', 10, 3, 300, (select id from public.account_titles where name = 'テスト仕訳')),
  ('テストペン', '本',  5, 2, 100, (select id from public.account_titles where name = 'テスト仕訳'));
insert into public.employees (employee_no, name, email) values
  ('T001', 'テスト 太郎', 'taro@example.com'),
  ('T002', 'テスト 次郎', null);
update public.app_settings set device_key_hash = extensions.crypt('test-key', extensions.gen_salt('bf', 4)) where id;
delete from public.mail_outbox;
delete from public.auth_failures;

create temp table ids as
select (select id from public.items where name = 'テスト用紙') as paper,
       (select id from public.items where name = 'テストペン') as pen;
grant select on ids to anon;

-- ================= 正常な使用 =================
create temp table r_ok as
select public.kiosk_use_items('test-key', '11111111-1111-1111-1111-111111111111', 'T001',
  jsonb_build_array(jsonb_build_object('item_id', (select paper from ids), 'quantity', 2)), 'manual', null) as res;

select is((select res ->> 'ok' from r_ok), 'true', '正常な使用: ok=true');
select is((select stock from public.items where id = (select paper from ids)), 8, '正常な使用: 在庫が 10→8 に減る');
select is((select count(*)::int from public.usages where batch_id = '11111111-1111-1111-1111-111111111111'), 1, '正常な使用: 利用明細が1件記録される');
select is((select employee_name from public.usage_batches where id = '11111111-1111-1111-1111-111111111111'), 'テスト 太郎', '正常な使用: 氏名が記録される');
select is((select employee_no from public.v_usage_history where batch_id = '11111111-1111-1111-1111-111111111111'), 'T001', '正常な使用: 利用状況ビューに社員番号が出る');
select is((select res -> 'lines' -> 0 ->> 'stock_after' from r_ok), '8', '正常な使用: 結果に使用後在庫が含まれる');
select is((select count(*)::int from public.mail_outbox where kind = 'usage_employee' and to_address = 'taro@example.com'), 1, '正常な使用: 利用者本人宛メールが1通登録される');
select is((select count(*)::int from public.mail_outbox where kind = 'usage_admin'), 2, '正常な使用: 備品担当者（管理者2名）宛メールが登録される');
select ok((select body from public.mail_outbox where kind = 'usage_employee') like '%テスト用紙　2冊%', 'メール本文: 備品名と数量');
select ok((select body from public.mail_outbox where kind = 'usage_employee') like '%利用者　：テスト 太郎%', 'メール本文: 利用者名');
select ok((select body from public.mail_outbox where kind = 'usage_employee') ~ '利用日時：\d{4}/\d{2}/\d{2} \d{2}:\d{2}', 'メール本文: 利用日時（JST）');
select ok((select body from public.mail_outbox where kind = 'usage_admin' limit 1) like '%残り 8冊%', '担当者メール本文: 使用後の在庫');

-- ================= 同じリクエストの再送（二重登録防止） =================
create temp table r_dup as
select public.kiosk_use_items('test-key', '11111111-1111-1111-1111-111111111111', 'T001',
  jsonb_build_array(jsonb_build_object('item_id', (select paper from ids), 'quantity', 2)), 'manual', null) as res;
select is((select res ->> 'duplicate' from r_dup), 'true', '再送: duplicate=true で前回結果を返す');
select is((select stock from public.items where id = (select paper from ids)), 8, '再送: 在庫は二重に減らない');
select is((select count(*)::int from public.mail_outbox), 3, '再送: メールも二重登録されない');

-- ================= 未登録の社員番号 =================
create temp table r_unknown as
select public.kiosk_use_items('test-key', gen_random_uuid(), 'X999',
  jsonb_build_array(jsonb_build_object('item_id', (select paper from ids), 'quantity', 1))) as res;
select is((select res ->> 'error' from r_unknown), 'unknown_employee', '未登録社員: unknown_employee');
select is((select stock from public.items where id = (select paper from ids)), 8, '未登録社員: 在庫は変わらない');
select is((select count(*)::int from public.usage_batches), 1, '未登録社員: 履歴は増えない');

-- ================= 在庫不足 =================
create temp table r_short as
select public.kiosk_use_items('test-key', gen_random_uuid(), 'T001',
  jsonb_build_array(jsonb_build_object('item_id', (select paper from ids), 'quantity', 9))) as res;
select is((select res ->> 'error' from r_short), 'insufficient_stock', '在庫不足: insufficient_stock');
select is((select res -> 'shortages' -> 0 ->> 'stock' from r_short), '8', '在庫不足: 理由として現在庫を返す');
select is((select stock from public.items where id = (select paper from ids)), 8, '在庫不足: 消費しない');

-- 複数品目のうち1つが不足 → 全部登録しない
create temp table r_multi as
select public.kiosk_use_items('test-key', gen_random_uuid(), 'T001',
  jsonb_build_array(jsonb_build_object('item_id', (select paper from ids), 'quantity', 1),
                    jsonb_build_object('item_id', (select pen from ids), 'quantity', 6)), 'natural_language', '用紙1冊とペン6本') as res;
select is((select res ->> 'error' from r_multi), 'insufficient_stock', '複数品目の一部不足: エラー');
select is((select stock from public.items where id = (select paper from ids)), 8, '複数品目の一部不足: 足りている備品も消費しない');
select is((select stock from public.items where id = (select pen from ids)), 5, '複数品目の一部不足: 不足備品も変わらない');
select is((select count(*)::int from public.mail_outbox), 3, '在庫不足: メールは登録されない');

-- 同じ備品が複数行 → 合算して判定
create temp table r_sum as
select public.kiosk_use_items('test-key', gen_random_uuid(), 'T002',
  jsonb_build_array(jsonb_build_object('item_id', (select pen from ids), 'quantity', 2),
                    jsonb_build_object('item_id', (select pen from ids), 'quantity', 3))) as res;
select is((select stock from public.items where id = (select pen from ids)), 0, '同一備品の複数行は合算して消費（5→0）');
select is((select count(*)::int from public.mail_outbox where ref_batch_id = (select (res ->> 'batch_id')::uuid from r_sum) and kind = 'usage_employee'), 0,
  'メールアドレス未登録の社員には本人宛メールを登録しない');

-- ================= 数量チェック =================
select is(public.kiosk_use_items('test-key', gen_random_uuid(), 'T001', '[{"item_id": 1, "quantity": 0}]'::jsonb) ->> 'error', 'invalid_quantity', '数量0は不可');
select is(public.kiosk_use_items('test-key', gen_random_uuid(), 'T001', '[{"item_id": 1, "quantity": -1}]'::jsonb) ->> 'error', 'invalid_quantity', '負の数量は不可');
select is(public.kiosk_use_items('test-key', gen_random_uuid(), 'T001', '[{"item_id": 1, "quantity": 1.5}]'::jsonb) ->> 'error', 'invalid_quantity', '小数は不可');
select is(public.kiosk_use_items('test-key', gen_random_uuid(), 'T001', '[{"item_id": 1, "quantity": "2"}]'::jsonb) ->> 'error', 'invalid_quantity', '文字列の数量は不可');
select is(public.kiosk_use_items('test-key', gen_random_uuid(), 'T001', '[]'::jsonb) ->> 'error', 'no_items', '備品未選択は不可');

-- ================= 端末キー =================
select is(public.kiosk_use_items('wrong-key', gen_random_uuid(), 'T001',
  jsonb_build_array(jsonb_build_object('item_id', (select paper from ids), 'quantity', 1))) ->> 'error', 'invalid_device_key', '端末キー不一致は拒否');
select is((select stock from public.items where id = (select paper from ids)), 8, '端末キー不一致: 在庫は変わらない');

-- 同一IPから10回失敗するとロック（正しいキーでも一時拒否）、別IPは影響なし
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9"}', true);
select public.kiosk_verify_device_key('bad') from generate_series(1, 10);
select is(public.kiosk_verify_device_key('test-key') ->> 'error', 'device_key_locked', '総当たり対策: 10回失敗でロック');
select set_config('request.headers', '{"x-forwarded-for": "198.51.100.7"}', true);
select is(public.kiosk_verify_device_key('test-key') ->> 'ok', 'true', '総当たり対策: 別IPは利用できる');

-- ================= anon の権限 =================
set local role anon;
select throws_ok('select * from public.employees', '42501', null, 'anon は社員マスタを直接読めない');
select throws_ok($$select public.admin_restock(1, 1, 100)$$, '42501', null, 'anon は補充RPCを実行できない');
select ok((public.kiosk_list_items('test-key') -> 'items' -> 0) ? 'stock' and not ((public.kiosk_list_items('test-key') -> 'items' -> 0) ? 'unit_price'),
  'anon は端末キー付きで備品一覧（価格なし）を取得できる');
reset role;

select * from finish();
rollback;
