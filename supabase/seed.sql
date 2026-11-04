-- 開発用サンプルデータ（supabase db reset 時に投入されます。本番では使いません）

insert into public.account_titles (name, code, sort_order) values
  ('事務用品費', '7410', 1),
  ('消耗品費',   '7420', 2);

insert into public.items (name, unit, stock, threshold, unit_price, account_title_id, sort_order) values
  ('コピー用紙 A4（500枚）', '冊', 20, 10, 380,  (select id from public.account_titles where name = '事務用品費'), 1),
  ('ボールペン 黒',          '本', 30, 10, 110,  (select id from public.account_titles where name = '事務用品費'), 2),
  ('ボールペン 赤',          '本', 12,  5, 110,  (select id from public.account_titles where name = '事務用品費'), 3),
  ('付箋 75mm角',            '冊', 15,  5, 198,  (select id from public.account_titles where name = '事務用品費'), 4),
  ('単3乾電池',              '本', 24, 12,  45,  (select id from public.account_titles where name = '消耗品費'),   5),
  ('単4乾電池',              '本',  6,  8,  48,  (select id from public.account_titles where name = '消耗品費'),   6);

-- カテゴリの割り当て（カテゴリ自体はマイグレーションで作成済み）
update public.items i set category_id = c.id
  from public.item_categories c
 where (i.name like 'コピー用紙%' and c.name = 'コピー用紙')
    or (i.name like 'ボールペン%' and c.name = '文房具')
    or (i.name like '付箋%'       and c.name = '文房具')
    or (i.name like '単_乾電池'   and c.name = '家電');

insert into public.employees (employee_no, name, email) values
  ('1001', '山田 太郎', 'yamada@example.com'),
  ('1002', '佐藤 花子', 'sato@example.com'),
  ('1003', '鈴木 一郎', null);

-- 開発用の端末キー: dev-device-key
update public.app_settings
   set device_key_hash = extensions.crypt('dev-device-key', extensions.gen_salt('bf', 8)),
       device_key_version = 1,
       device_key_updated_at = now(),
       device_key_updated_by = 'seed'
 where id;

-- ローカル開発用: pg_cron → send-mail の呼び出し先と秘密値（supabase/functions/.env の MAIL_WORKER_SECRET と同じ値）
-- Docker Desktop（Windows/Mac）では DB コンテナからホストの API に host.docker.internal で到達できる
select vault.create_secret('http://host.docker.internal:54321/functions/v1/send-mail', 'mail_worker_url');
select vault.create_secret('local-dev-worker-secret', 'mail_worker_secret');
