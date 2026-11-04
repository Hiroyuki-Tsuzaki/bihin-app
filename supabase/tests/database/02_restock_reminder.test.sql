-- 補充・日次補充依頼・メール送信失敗・端末キー変更のテスト
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

update public.items set is_active = false;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'notadmin@example.com');
insert into public.app_admins (user_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.com');
insert into public.items (name, unit, stock, threshold, unit_price) values
  ('通知テスト電池', '本', 3, 5, 50),
  ('通知テスト用紙', '冊', 9, 2, 300);
insert into public.employees (employee_no, name, email) values ('T001', 'テスト 太郎', 'taro@example.com');
update public.app_settings set device_key_hash = extensions.crypt('test-key', extensions.gen_salt('bf', 4)) where id;
delete from public.mail_outbox;
delete from public.reminder_log;
delete from public.auth_failures;

create temp table ids as
select (select id from public.items where name = '通知テスト電池') as bat,
       (select id from public.items where name = '通知テスト用紙') as paper;
grant select on ids to authenticated;

-- ================= 権限 =================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000b1", "role": "authenticated"}', true);
select throws_ok($$select public.admin_restock((select bat from ids), 1, 50)$$, '42501', null, '管理者でないログインユーザーは補充できない');
select is((select count(*)::int from public.items), 0, '管理者でないログインユーザーは備品マスタを読めない（RLS）');

-- ================= 補充による在庫加算 =================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated"}', true);
create temp table r_rs as select public.admin_restock((select bat from ids), 1, 48.5, '購入テスト') as res;
select is((select res ->> 'stock_after' from r_rs), '4', '補充: 3+1=4 を返す');
select is((select stock from public.items where id = (select bat from ids)), 4, '補充: 在庫に加算される');
select is((select res ->> 'above_threshold' from r_rs), 'false', '補充: しきい値(5)以下のまま');
select is((select unit_price from public.restocks where item_id = (select bat from ids)), 48.50::numeric(12,2), '補充: 実際の購入単価が記録される');
select is((select created_by_email from public.restocks where item_id = (select bat from ids)), 'admin1@example.com', '補充: 登録者が記録される');
select is((select count(*)::int from public.mail_outbox), 0, '補充: メール通知は行わない');
select throws_ok($$select public.admin_restock((select bat from ids), 0, 50)$$, '22023', null, '補充数0は不可');
select throws_ok($$select public.admin_restock((select bat from ids), 1, -1)$$, '22023', null, '負の購入単価は不可');
select ok((select count(*) from public.items) >= 2, '管理者は備品マスタを読める（RLS）');
reset role;

-- ================= しきい値以下での日次通知 =================
-- 電池: 在庫4 / しきい値5 → 対象、用紙: 在庫9 / しきい値2 → 対象外
select is(private.run_daily_reminders('2026-10-01'), 1, '日次通知: しきい値以下の1品目が対象');
select is((select count(*)::int from public.reminder_log where item_id = (select bat from ids) and reminder_date = '2026-10-01'), 1, '日次通知: 送信記録が残る');
select is((select count(*)::int from public.mail_outbox where kind = 'restock_reminder'), 2, '日次通知: 備品担当者（2名）宛に登録');
select ok((select body from public.mail_outbox where kind = 'restock_reminder' limit 1) like '%通知テスト電池%', '補充依頼メール: 備品名');
select ok((select body from public.mail_outbox where kind = 'restock_reminder' limit 1) like '%現在庫数：4本%', '補充依頼メール: 現在庫数');
select ok((select body from public.mail_outbox where kind = 'restock_reminder' limit 1) like '%通知しきい値：5本%', '補充依頼メール: 通知しきい値');
select ok((select body from public.mail_outbox where kind = 'restock_reminder' limit 1) not like '%通知テスト用紙%', '補充依頼メール: しきい値超の備品は含まない');

-- ================= 同日の重複通知防止 =================
select is(private.run_daily_reminders('2026-10-01'), 0, '同日再実行: 対象0件');
select is((select count(*)::int from public.mail_outbox where kind = 'restock_reminder'), 2, '同日再実行: メールは増えない');

-- ================= 補充後もしきい値以下なら翌日も通知 =================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated"}', true);
select public.admin_restock((select bat from ids), 1, 50);   -- 4 → 5（= しきい値）
select is(private.run_daily_reminders('2026-10-02'), 1, '補充後もしきい値以下(5<=5): 翌日も通知');

-- ================= しきい値超過後は通知停止 =================
select public.admin_restock((select bat from ids), 10, 50);  -- 5 → 15
select is(private.run_daily_reminders('2026-10-03'), 0, 'しきい値超過(15>5): 通知停止');
select is((select count(*)::int from public.mail_outbox where kind = 'restock_reminder'), 4, '通知停止: 補充依頼メールは増えない');

-- 使用で再びしきい値以下になれば通知再開
select public.kiosk_use_items('test-key', gen_random_uuid(), 'T001',
  jsonb_build_array(jsonb_build_object('item_id', (select bat from ids), 'quantity', 11)));
select is(private.run_daily_reminders('2026-10-04'), 1, '使用で再びしきい値以下(4): 通知再開');

-- 管理画面からの手動実行（当日分。すでに送信済みなら0）
select is((public.admin_run_daily_reminders() ->> 'ok'), 'true', '管理者は日次通知を手動実行できる');

-- ================= メール送信失敗時の扱い =================
delete from public.mail_outbox;
select public.kiosk_use_items('test-key', gen_random_uuid(), 'T001',
  jsonb_build_array(jsonb_build_object('item_id', (select paper from ids), 'quantity', 1)));
create temp table stock_before as select stock from public.items where id = (select paper from ids);
create temp table claimed as select * from public.worker_claim_mail(10);
select is((select count(*)::int from claimed), 3, '送信ワーカー: 送信待ちを取得（本人1+担当者2）');
select is((select count(*)::int from public.worker_claim_mail(10)), 0, '送信ワーカー: 取得中のものは二重取得しない');
select public.worker_complete_mail(id, false, 'SMTP timeout') from claimed;
select is((select count(*)::int from public.mail_outbox where status = 'pending' and attempts = 1 and next_attempt_at > now()), 3,
  '送信失敗: 再送待ちに戻り、次回時刻が延期される');
select is((select stock from public.items where id = (select paper from ids)), (select stock from stock_before), '送信失敗: 在庫は変わらない');
select is((select count(*)::int from public.usage_batches), 2, '送信失敗: 履歴は重複しない');
update public.mail_outbox set attempts = max_attempts, status = 'sending', next_attempt_at = now();
select public.worker_complete_mail(id, false, 'SMTP timeout') from public.mail_outbox;
select is((select count(*)::int from public.mail_outbox where status = 'failed'), 3, '最大回数を超えたら failed');

-- ================= 端末キーの変更 =================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated"}', true);
select throws_ok($$select public.admin_set_device_key('short')$$, '22023', null, '端末キーは8文字以上');
select public.admin_set_device_key('new-device-key-2026');
select is(public.kiosk_verify_device_key('test-key') ->> 'error', 'invalid_device_key', 'キー変更後は旧キーが使えない');
select is(public.kiosk_verify_device_key('new-device-key-2026') ->> 'ok', 'true', 'キー変更後は新キーが使える');

select * from finish();
rollback;
