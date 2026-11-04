-- 月次集計（仕訳別の使用ベース / 購入ベース）のテスト
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

update public.items set is_active = false;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.com');
insert into public.app_admins (user_id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.com');
insert into public.account_titles (name, sort_order) values ('月次テスト事務用品費', 1), ('月次テスト消耗品費', 2);
insert into public.items (name, unit, stock, threshold, unit_price, account_title_id) values
  ('月次用紙', '冊', 100, 5, 300, (select id from public.account_titles where name = '月次テスト事務用品費')),
  ('月次電池', '本', 100, 5,  50, (select id from public.account_titles where name = '月次テスト消耗品費'));
insert into public.employees (employee_no, name) values ('M001', '月次 太郎');
update public.app_settings set device_key_hash = extensions.crypt('test-key', extensions.gen_salt('bf', 4)) where id;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated"}', true);

create temp table ids as
select (select id from public.items where name = '月次用紙') as paper,
       (select id from public.items where name = '月次電池') as bat;

-- 今月: 用紙3冊(300円) + 電池4本(50円) を使用、用紙10冊を280円で購入
select public.kiosk_use_items('test-key', gen_random_uuid(), 'M001',
  jsonb_build_array(jsonb_build_object('item_id', (select paper from ids), 'quantity', 3),
                    jsonb_build_object('item_id', (select bat from ids), 'quantity', 4)));
select public.admin_restock((select paper from ids), 10, 280);
-- 前月分: 用紙1冊
select public.kiosk_use_items('test-key', '22222222-2222-2222-2222-222222222222', 'M001',
  jsonb_build_array(jsonb_build_object('item_id', (select paper from ids), 'quantity', 1)));
update public.usages set used_at = now() - interval '1 month' where batch_id = '22222222-2222-2222-2222-222222222222';
update public.usage_batches set used_at = now() - interval '1 month' where id = '22222222-2222-2222-2222-222222222222';

create temp table s as select public.admin_monthly_summary((now() at time zone 'Asia/Tokyo')::date) as j;
create temp table acct as
select e ->> 'account_title' as name, (e ->> 'usage_cost')::numeric as usage_cost, (e ->> 'purchase_cost')::numeric as purchase_cost
  from s, jsonb_array_elements(j -> 'by_account_title') e;
create temp table itm as
select e ->> 'item_name' as name, (e ->> 'used_qty')::int as used_qty, (e ->> 'prev_used_qty')::int as prev_used_qty
  from s, jsonb_array_elements(j -> 'by_item') e;

select is((select usage_cost from acct where name = '月次テスト事務用品費'), 900::numeric, '使用ベース: 事務用品費 = 3冊×300円');
select is((select usage_cost from acct where name = '月次テスト消耗品費'), 200::numeric, '使用ベース: 消耗品費 = 4本×50円');
select is((select purchase_cost from acct where name = '月次テスト事務用品費'), 2800::numeric, '購入ベース: 事務用品費 = 10冊×280円（実購入単価）');
select is((select purchase_cost from acct where name = '月次テスト消耗品費'), 0::numeric, '購入ベース: 消耗品費 = 0');
select is((select used_qty from itm where name = '月次用紙'), 3, '備品別: 今月の使用数');
select is((select prev_used_qty from itm where name = '月次用紙'), 1, '備品別: 前月の使用数（増減比較用）');
select is((select (j -> 'totals' ->> 'usage_count')::int from s), 1, '合計: 今月の受取回数');

reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.admin_monthly_summary(current_date)$$, '42501', null, '未ログインでは月次集計を取得できない');

select * from finish();
rollback;
