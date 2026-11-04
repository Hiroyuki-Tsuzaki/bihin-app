-- 備品カテゴリのテスト
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

update public.items set is_active = false;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'notadmin@example.com');
insert into public.app_admins (user_id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.com');
update public.app_settings set device_key_hash = extensions.crypt('test-key', extensions.gen_salt('bf', 4)) where id;

insert into public.items (name, unit, stock, threshold, category_id) values
  ('カテゴリテスト用紙', '冊', 5, 1, (select id from public.item_categories where name = 'コピー用紙')),
  ('カテゴリテスト電池', '本', 5, 1, (select id from public.item_categories where name = '家電')),
  ('カテゴリ未設定品',   '個', 5, 1, null);

-- 初期カテゴリ
select is((select string_agg(name, ',' order by sort_order) from public.item_categories),
  'コピー用紙,封筒,文房具,家電,飲み物', '初期カテゴリ5件が表示順どおりに登録されている');

-- 利用端末向け一覧
create temp table r as select public.kiosk_list_items('test-key') as j;
select is((select jsonb_array_length(j -> 'categories') from r), 5, '一覧に有効なカテゴリ5件が含まれる');
select is((select j -> 'categories' -> 0 ->> 'name' from r), 'コピー用紙', 'カテゴリは表示順で返る');
select is((select e ->> 'category_name' from r, jsonb_array_elements(j -> 'items') e where e ->> 'name' = 'カテゴリテスト電池'), '家電',
  '備品にカテゴリ名が付く');
select ok((select (e -> 'category_id') = 'null'::jsonb from r, jsonb_array_elements(j -> 'items') e where e ->> 'name' = 'カテゴリ未設定品'),
  'カテゴリ未設定の備品も一覧に含まれ、category_id は null');
select ok((select not (e ? 'unit_price') from r, jsonb_array_elements(j -> 'items') e limit 1), '価格は引き続き返さない');

-- 無効化したカテゴリはタブから消え、その備品は未設定扱い
update public.item_categories set is_active = false where name = '家電';
select is((select jsonb_array_length(public.kiosk_list_items('test-key') -> 'categories')), 4, '無効なカテゴリはタブに出ない');
select ok((select (e -> 'category_id') = 'null'::jsonb from jsonb_array_elements(public.kiosk_list_items('test-key') -> 'items') e
            where e ->> 'name' = 'カテゴリテスト電池'), '無効なカテゴリの備品は未設定扱い（「すべて」にだけ表示）');

-- カテゴリを削除すると備品は未設定に戻る
delete from public.item_categories where name = 'コピー用紙';
select is((select category_id from public.items where name = 'カテゴリテスト用紙'), null::bigint, 'カテゴリ削除で備品は未設定に戻る');

-- 権限
set local role anon;
select throws_ok('select * from public.item_categories', '42501', null, 'anon はカテゴリマスタを直接読めない');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000b1", "role": "authenticated"}', true);
select is((select count(*)::int from public.item_categories), 0, '管理者でないユーザーはカテゴリマスタを読めない');
reset role;

select * from finish();
rollback;
