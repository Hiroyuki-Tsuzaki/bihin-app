-- =====================================================================
-- 備品管理アプリ 初期スキーマ
--   * 利用端末（ログインなし）は端末キー付きの kiosk_* RPC だけを呼べる
--   * 管理画面は Supabase Auth でログインした app_admins のユーザーだけが操作できる
--   * メールは mail_outbox に積み、Edge Function(send-mail) が非同期で送る
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------------------

-- 管理者（備品担当者）。ここに登録されたユーザー全員が通知メールの宛先になる
create table public.app_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  created_at  timestamptz not null default now()
);

-- 仕訳項目マスタ
create table public.account_titles (
  id          bigint generated always as identity primary key,
  name        text not null unique check (length(btrim(name)) > 0),
  code        text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 備品マスタ
create table public.items (
  id                bigint generated always as identity primary key,
  name              text not null check (length(btrim(name)) > 0),
  unit              text not null default '個' check (length(btrim(unit)) > 0),
  image_path        text,
  stock             integer not null default 0 check (stock >= 0),
  threshold         integer not null default 0 check (threshold >= 0),
  unit_price        numeric(12,2) not null default 0 check (unit_price >= 0),  -- 税抜単価
  account_title_id  bigint references public.account_titles(id),
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 社員マスタ
create table public.employees (
  id           bigint generated always as identity primary key,
  employee_no  text not null unique check (employee_no ~ '^[0-9A-Za-z_-]{1,20}$'),
  name         text not null check (length(btrim(name)) > 0),
  email        text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 受取（使用）1回分。id は端末が発行したリクエストID（二重送信防止）
create table public.usage_batches (
  id             uuid primary key,
  employee_id    bigint not null references public.employees(id),
  employee_no    text not null,     -- 記録時点の値を保存
  employee_name  text not null,
  source         text not null default 'manual' check (source in ('manual', 'natural_language')),
  raw_text       text,
  result         jsonb not null default '{}'::jsonb,
  used_at        timestamptz not null default now()
);
create index usage_batches_used_at_idx on public.usage_batches (used_at desc);

-- 受取明細（備品ごと）
create table public.usages (
  id                bigint generated always as identity primary key,
  batch_id          uuid not null references public.usage_batches(id),
  item_id           bigint not null references public.items(id),
  item_name         text not null,
  unit              text not null,
  quantity          integer not null check (quantity > 0),
  unit_price        numeric(12,2) not null,   -- 使用時点のマスタ税抜単価
  account_title_id  bigint references public.account_titles(id),
  stock_after       integer not null,
  used_at           timestamptz not null default now()
);
create index usages_used_at_idx on public.usages (used_at);
create index usages_item_used_at_idx on public.usages (item_id, used_at);

-- 補充（購入）履歴
create table public.restocks (
  id                bigint generated always as identity primary key,
  item_id           bigint not null references public.items(id),
  item_name         text not null,
  unit              text not null,
  quantity          integer not null check (quantity > 0),
  unit_price        numeric(12,2) not null check (unit_price >= 0),  -- 実際の購入税抜単価
  account_title_id  bigint references public.account_titles(id),
  stock_before      integer not null,
  stock_after       integer not null,
  note              text,
  created_by        uuid references auth.users(id) on delete set null,
  created_by_email  text,
  created_at        timestamptz not null default now()
);
create index restocks_created_at_idx on public.restocks (created_at);

-- 補充依頼メールの送信記録（備品×日付で一意 → 同日重複送信防止）
create table public.reminder_log (
  item_id        bigint not null references public.items(id),
  reminder_date  date not null,
  stock_at       integer not null,
  threshold_at   integer not null,
  created_at     timestamptz not null default now(),
  primary key (item_id, reminder_date)
);

-- メール送信待ち（Outbox）
create table public.mail_outbox (
  id                 bigint generated always as identity primary key,
  kind               text not null check (kind in ('usage_employee', 'usage_admin', 'restock_reminder')),
  to_address         text not null,
  subject            text not null,
  body               text not null,
  status             text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts           integer not null default 0,
  max_attempts       integer not null default 5,
  last_error         text,
  next_attempt_at    timestamptz not null default now(),
  locked_at          timestamptz,
  ref_batch_id       uuid,
  ref_reminder_date  date,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);
create index mail_outbox_status_idx on public.mail_outbox (status, next_attempt_at);

-- アプリ設定（1行だけ）
create table public.app_settings (
  id                      boolean primary key default true check (id),
  device_key_hash         text,
  device_key_version      integer not null default 0,
  device_key_updated_at   timestamptz,
  device_key_updated_by   text
);
insert into public.app_settings (id) values (true);

-- 端末キー・社員番号の総当たり対策（接続元IPごとの失敗回数）
create table public.auth_failures (
  client_ip          text not null,
  kind               text not null check (kind in ('device_key', 'employee_no')),
  failures           integer not null default 0,
  window_started_at  timestamptz not null default now(),
  locked_until       timestamptz,
  primary key (client_ip, kind)
);

-- 月次レポート（AI生成）
create table public.monthly_reports (
  id                bigint generated always as identity primary key,
  target_month      date not null,
  content           text not null,
  stats             jsonb not null,
  model             text,
  created_by        uuid references auth.users(id) on delete set null,
  created_by_email  text,
  created_at        timestamptz not null default now()
);
create index monthly_reports_month_idx on public.monthly_reports (target_month desc, created_at desc);

-- updated_at 自動更新
create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger items_touch before update on public.items
  for each row execute function private.touch_updated_at();
create trigger employees_touch before update on public.employees
  for each row execute function private.touch_updated_at();
create trigger account_titles_touch before update on public.account_titles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- 共通関数
-- ---------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

create or replace function private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception '管理者権限がありません' using errcode = '42501';
  end if;
end $$;

create or replace function private.jst_text(p_ts timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_ts at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI');
$$;

create or replace function private.err(p_code text, p_message text, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'error', p_code, 'message', p_message) || p_extra;
$$;

-- PostgREST 経由の呼び出し元IP（取れなければ 'unknown'）
create or replace function private.client_ip() returns text
language plpgsql stable set search_path = '' as $$
declare
  v_headers jsonb;
  v_ip text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  -- Cloudflare が付与する cf-connecting-ip を優先（利用者が偽装しにくい）。無ければ x-forwarded-for の先頭
  v_ip := nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '');
  return coalesce(nullif(v_headers ->> 'cf-connecting-ip', ''), v_ip, nullif(v_headers ->> 'x-real-ip', ''), 'unknown');
end $$;

-- 失敗回数の記録。上限に達したら一定時間ロック
create or replace function private.record_failure(p_kind text, p_max integer, p_window interval, p_lock interval)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := private.client_ip();
  v_row public.auth_failures;
begin
  select * into v_row from public.auth_failures where client_ip = v_ip and kind = p_kind for update;
  if not found then
    insert into public.auth_failures (client_ip, kind, failures, window_started_at)
    values (v_ip, p_kind, 1, now())
    on conflict (client_ip, kind) do update set failures = public.auth_failures.failures + 1;
    return;
  end if;
  if v_row.window_started_at < now() - p_window then
    v_row.failures := 0;
    v_row.window_started_at := now();
  end if;
  v_row.failures := v_row.failures + 1;
  update public.auth_failures
     set failures = v_row.failures,
         window_started_at = v_row.window_started_at,
         locked_until = case when v_row.failures >= p_max then now() + p_lock else locked_until end
   where client_ip = v_ip and kind = p_kind;
end $$;

create or replace function private.is_locked(p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.auth_failures
     where client_ip = private.client_ip() and kind = p_kind
       and locked_until is not null and locked_until > now());
$$;

-- 端末キーの検証: 'ok' | 'invalid' | 'locked' | 'not_configured'
create or replace function private.check_device_key(p_key text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
begin
  select device_key_hash into v_hash from public.app_settings where id;
  if v_hash is null then
    return 'not_configured';
  end if;
  if private.is_locked('device_key') then
    return 'locked';
  end if;
  if p_key is not null and length(p_key) <= 200 and extensions.crypt(p_key, v_hash) = v_hash then
    return 'ok';
  end if;
  -- 15分間に10回失敗で15分ロック
  perform private.record_failure('device_key', 10, interval '15 minutes', interval '15 minutes');
  return 'invalid';
end $$;

create or replace function private.device_key_error(p_status text) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_status
    when 'locked' then private.err('device_key_locked', '失敗が続いたため一時的に利用を停止しています。15分ほど待ってから再度お試しください。')
    when 'not_configured' then private.err('device_key_not_configured', '端末キーが未設定です。備品担当者に連絡してください。')
    else private.err('invalid_device_key', '端末キーが正しくないか、変更されています。備品担当者に確認してください。')
  end;
$$;

-- jsonb 値が正の整数か
create or replace function private.is_positive_int(p_value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then
    return false;
  end if;
  v := (p_value #>> '{}')::numeric;
  return v = trunc(v) and v > 0 and v <= 2147483647;
end $$;

-- ---------------------------------------------------------------------
-- 利用端末向け RPC（anon から呼ぶ。すべて端末キー必須）
-- ---------------------------------------------------------------------

create or replace function public.kiosk_verify_device_key(p_device_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_status text := private.check_device_key(p_device_key);
begin
  if v_status <> 'ok' then
    return private.device_key_error(v_status);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kiosk_list_items(p_device_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_status text := private.check_device_key(p_device_key);
begin
  if v_status <> 'ok' then
    return private.device_key_error(v_status);
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'name', i.name, 'unit', i.unit, 'image_path', i.image_path,
             'stock', i.stock, 'low', i.stock <= i.threshold)
           order by i.sort_order, i.name)
      from public.items i where i.is_active), '[]'::jsonb));
end $$;

-- 社員番号 → 氏名（受取確認ダイアログ用）
create or replace function public.kiosk_lookup_employee(p_device_key text, p_employee_no text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_status text := private.check_device_key(p_device_key);
  v_name text;
begin
  if v_status <> 'ok' then
    return private.device_key_error(v_status);
  end if;
  if private.is_locked('employee_no') then
    return private.err('employee_lookup_locked', '社員番号の誤入力が続いたため一時的に停止しています。15分ほど待ってから再度お試しください。');
  end if;
  select name into v_name from public.employees
   where employee_no = btrim(coalesce(p_employee_no, '')) and is_active;
  if v_name is null then
    -- 15分間に30回の未登録番号で15分ロック（番号の総当たり対策）
    perform private.record_failure('employee_no', 30, interval '15 minutes', interval '15 minutes');
    return private.err('unknown_employee', '登録されていない社員番号です。番号を確認してください。');
  end if;
  return jsonb_build_object('ok', true, 'employee_name', v_name);
end $$;

-- 備品の受取（使用）を確定する。在庫減算・履歴登録・メール登録を1トランザクションで行う
--   p_lines: [{"item_id": 1, "quantity": 2}, ...]
--   1品目でも在庫不足・不正があれば何も登録しない
create or replace function public.kiosk_use_items(
  p_device_key  text,
  p_request_id  uuid,
  p_employee_no text,
  p_lines       jsonb,
  p_source      text default 'manual',
  p_raw_text    text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_status   text := private.check_device_key(p_device_key);
  v_existing jsonb;
  v_lines    jsonb;
  v_line     record;
  v_item     public.items;
  v_emp      public.employees;
  v_short    jsonb := '[]'::jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
  v_list_emp text := '';
  v_list_adm text := '';
  v_result   jsonb;
begin
  if v_status <> 'ok' then
    return private.device_key_error(v_status);
  end if;
  if p_request_id is null then
    return private.err('invalid_request', 'リクエストIDがありません。画面を再読み込みしてください。');
  end if;
  if coalesce(p_source, 'manual') not in ('manual', 'natural_language') then
    return private.err('invalid_request', '入力方法が不正です。');
  end if;

  -- 同じリクエストIDの同時実行を直列化し、処理済みなら前回結果を返す（二重登録防止）
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select result into v_existing from public.usage_batches where id = p_request_id;
  if found then
    return v_existing || jsonb_build_object('duplicate', true);
  end if;

  -- 入力チェック
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return private.err('no_items', '備品が選択されていません。');
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
              where jsonb_typeof(e) <> 'object' or not private.is_positive_int(e -> 'item_id')) then
    return private.err('invalid_item', '備品の指定が不正です。');
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
              where not private.is_positive_int(e -> 'quantity')) then
    return private.err('invalid_quantity', '数量は1以上の整数で入力してください。');
  end if;

  -- 同じ備品が複数行あれば合算
  select jsonb_agg(jsonb_build_object('item_id', s.item_id, 'quantity', s.qty) order by s.item_id)
    into v_lines
    from (select (e ->> 'item_id')::bigint as item_id, sum((e ->> 'quantity')::bigint) as qty
            from jsonb_array_elements(p_lines) e group by 1) s;
  if exists (select 1 from jsonb_array_elements(v_lines) l where (l ->> 'quantity')::bigint > 2147483647) then
    return private.err('invalid_quantity', '数量が大きすぎます。');
  end if;

  select * into v_emp from public.employees
   where employee_no = btrim(coalesce(p_employee_no, '')) and is_active;
  if not found then
    return private.err('unknown_employee', '登録されていない社員番号です。番号を確認してください。');
  end if;

  -- 備品行を id 順にロックして在庫を確認（デッドロック回避のため順序固定）
  for v_line in
    select (l ->> 'item_id')::bigint as item_id, (l ->> 'quantity')::integer as qty
      from jsonb_array_elements(v_lines) l order by 1
  loop
    select * into v_item from public.items where id = v_line.item_id for update;
    if not found or not v_item.is_active then
      return private.err('unknown_item', '選択された備品が見つかりません。画面を更新してください。');
    end if;
    if v_item.stock < v_line.qty then
      v_short := v_short || jsonb_build_object(
        'item_id', v_item.id, 'item_name', v_item.name, 'unit', v_item.unit,
        'requested', v_line.qty, 'stock', v_item.stock);
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    return private.err('insufficient_stock',
      '在庫が不足している備品があるため、登録しませんでした（すべての備品が未登録です）。',
      jsonb_build_object('shortages', v_short));
  end if;

  insert into public.usage_batches (id, employee_id, employee_no, employee_name, source, raw_text, used_at)
  values (p_request_id, v_emp.id, v_emp.employee_no, v_emp.name, coalesce(p_source, 'manual'),
          left(p_raw_text, 500), v_now);

  for v_line in
    select (l ->> 'item_id')::bigint as item_id, (l ->> 'quantity')::integer as qty
      from jsonb_array_elements(v_lines) l order by 1
  loop
    update public.items set stock = stock - v_line.qty
     where id = v_line.item_id
     returning * into v_item;

    insert into public.usages (batch_id, item_id, item_name, unit, quantity, unit_price, account_title_id, stock_after, used_at)
    values (p_request_id, v_item.id, v_item.name, v_item.unit, v_line.qty, v_item.unit_price,
            v_item.account_title_id, v_item.stock, v_now);

    v_out := v_out || jsonb_build_object(
      'item_id', v_item.id, 'item_name', v_item.name, 'unit', v_item.unit,
      'quantity', v_line.qty, 'stock_after', v_item.stock,
      'below_threshold', v_item.stock <= v_item.threshold);

    v_list_emp := v_list_emp || format(E'・%s　%s%s\n', v_item.name, v_line.qty, v_item.unit);
    v_list_adm := v_list_adm || format(E'・%s　%s%s（残り %s%s%s）\n',
      v_item.name, v_line.qty, v_item.unit, v_item.stock, v_item.unit,
      case when v_item.stock <= v_item.threshold
           then format('／しきい値 %s%s 以下', v_item.threshold, v_item.unit) else '' end);
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'batch_id', p_request_id,
    'employee_no', v_emp.employee_no,
    'employee_name', v_emp.name,
    'used_at', v_now,
    'used_at_jst', private.jst_text(v_now),
    'lines', v_out);
  update public.usage_batches set result = v_result where id = p_request_id;

  -- メールは Outbox に登録するだけ（送信失敗しても在庫・履歴には影響しない）
  if v_emp.email is not null then
    insert into public.mail_outbox (kind, to_address, subject, body, ref_batch_id)
    values ('usage_employee', v_emp.email,
      format('【備品管理】備品の受取を記録しました（%s）', private.jst_text(v_now)),
      format(E'%s さん\n\n以下の備品の受取を記録しました。\n\n利用日時：%s\n利用者　：%s（社員番号 %s）\n備品・数量：\n%s\n心当たりがない場合は、備品担当者までご連絡ください。\n\n※このメールは備品管理アプリから自動送信しています。',
        v_emp.name, private.jst_text(v_now), v_emp.name, v_emp.employee_no, v_list_emp),
      p_request_id);
  end if;

  insert into public.mail_outbox (kind, to_address, subject, body, ref_batch_id)
  select 'usage_admin', a.email,
    format('【備品管理】備品利用のお知らせ（%s さん）', v_emp.name),
    format(E'備品担当者各位\n\n備品の受取が記録されました。\n\n利用日時：%s\n利用者　：%s（社員番号 %s）\n備品・数量：\n%s\n※このメールは備品管理アプリから自動送信しています。',
      private.jst_text(v_now), v_emp.name, v_emp.employee_no, v_list_adm),
    p_request_id
  from (select distinct email from public.app_admins) a;

  return v_result;
end $$;

-- ---------------------------------------------------------------------
-- 管理者向け RPC
-- ---------------------------------------------------------------------

-- 補充登録（メール通知なし）
create or replace function public.admin_restock(
  p_item_id    bigint,
  p_quantity   integer,
  p_unit_price numeric,
  p_note       text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item   public.items;
  v_before integer;
  v_email  text;
begin
  perform private.require_admin();
  if p_quantity is null or p_quantity <= 0 then
    raise exception '補充数は1以上の整数で入力してください' using errcode = '22023';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception '購入単価（税抜）は0以上で入力してください' using errcode = '22023';
  end if;

  select * into v_item from public.items where id = p_item_id for update;
  if not found then
    raise exception '備品が見つかりません' using errcode = 'P0002';
  end if;
  v_before := v_item.stock;

  update public.items set stock = stock + p_quantity where id = p_item_id returning * into v_item;

  select email into v_email from public.app_admins where user_id = auth.uid();
  insert into public.restocks (item_id, item_name, unit, quantity, unit_price, account_title_id,
                               stock_before, stock_after, note, created_by, created_by_email)
  values (v_item.id, v_item.name, v_item.unit, p_quantity, round(p_unit_price, 2), v_item.account_title_id,
          v_before, v_item.stock, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), v_email);

  return jsonb_build_object(
    'ok', true, 'item_id', v_item.id, 'item_name', v_item.name, 'unit', v_item.unit,
    'quantity', p_quantity, 'stock_before', v_before, 'stock_after', v_item.stock,
    'threshold', v_item.threshold, 'above_threshold', v_item.stock > v_item.threshold);
end $$;

-- 端末キーの変更（変更すると全端末で再入力が必要）
create or replace function public.admin_set_device_key(p_new_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_version integer;
begin
  perform private.require_admin();
  if p_new_key is null or length(p_new_key) < 8 or length(p_new_key) > 200 then
    raise exception '端末キーは8文字以上で設定してください' using errcode = '22023';
  end if;
  select email into v_email from public.app_admins where user_id = auth.uid();
  update public.app_settings
     set device_key_hash = extensions.crypt(p_new_key, extensions.gen_salt('bf', 8)),
         device_key_version = device_key_version + 1,
         device_key_updated_at = now(),
         device_key_updated_by = v_email
   where id
   returning device_key_version into v_version;
  delete from public.auth_failures where kind = 'device_key';
  return jsonb_build_object('ok', true, 'version', v_version);
end $$;

create or replace function public.admin_device_key_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.app_settings;
begin
  perform private.require_admin();
  select * into v from public.app_settings where id;
  return jsonb_build_object(
    'configured', v.device_key_hash is not null,
    'version', v.device_key_version,
    'updated_at', v.device_key_updated_at,
    'updated_by', v.device_key_updated_by,
    'locked_ips', (select count(*) from public.auth_failures where locked_until > now()));
end $$;

create or replace function public.admin_clear_lockouts() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  delete from public.auth_failures;
end $$;

-- 日次の補充依頼（pg_cron から毎日 00:00 UTC = 09:00 JST に実行）
--   在庫 <= しきい値の備品を reminder_log に登録できた（=その日まだ未通知）分だけメール化する
create or replace function private.run_daily_reminders(p_today date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Tokyo')::date);
  v_count integer;
  v_list  text;
begin
  with inserted as (
    insert into public.reminder_log (item_id, reminder_date, stock_at, threshold_at)
    select i.id, v_today, i.stock, i.threshold
      from public.items i
     where i.is_active and i.stock <= i.threshold
    on conflict (item_id, reminder_date) do nothing
    returning item_id, stock_at, threshold_at
  )
  select count(*),
         string_agg(format(E'■ %s\n　現在庫数：%s%s ／ 通知しきい値：%s%s', i.name, x.stock_at, i.unit, x.threshold_at, i.unit),
                    E'\n' order by i.sort_order, i.name)
    into v_count, v_list
    from inserted x join public.items i on i.id = x.item_id;

  if v_count = 0 then
    return 0;
  end if;

  insert into public.mail_outbox (kind, to_address, subject, body, ref_reminder_date)
  select 'restock_reminder', a.email,
    format('【備品管理】補充依頼（%s品目）%s', v_count, to_char(v_today, 'YYYY/MM/DD')),
    format(E'備品担当者各位\n\n在庫数が通知しきい値以下の備品があります。補充をお願いします。\n\n%s\n\n補充により在庫数がしきい値を上回るまで、毎日9:00にお知らせします。\n\n※このメールは備品管理アプリから自動送信しています。', v_list),
    v_today
  from (select distinct email from public.app_admins) a;

  return v_count;
end $$;

create or replace function public.admin_run_daily_reminders() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform private.require_admin();
  v_count := private.run_daily_reminders(null);
  return jsonb_build_object('ok', true, 'notified_items', v_count);
end $$;

create or replace function public.admin_retry_mail(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.mail_outbox
     set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, locked_at = null
   where id = p_id and status = 'failed';
end $$;

-- 月次集計（使用ベース＝使った月に計上 / 購入ベース＝補充した月に計上）
create or replace function public.admin_monthly_summary(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start      date := date_trunc('month', p_month)::date;
  v_end        date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_prev_start date := (date_trunc('month', p_month) - interval '1 month')::date;
  v_from       timestamptz;
  v_to         timestamptz;
  v_prev_from  timestamptz;
  v_rate_to    timestamptz;
  v_rate_from  timestamptz;
begin
  perform private.require_admin();
  v_from      := v_start::timestamp at time zone 'Asia/Tokyo';
  v_to        := v_end::timestamp at time zone 'Asia/Tokyo';
  v_prev_from := v_prev_start::timestamp at time zone 'Asia/Tokyo';
  v_rate_to   := least(now(), v_to);
  v_rate_from := v_rate_to - interval '30 days';

  return jsonb_build_object(
    'month', to_char(v_start, 'YYYY-MM'),
    'totals', (
      select jsonb_build_object(
        'usage_cost',     coalesce((select sum(quantity * unit_price) from public.usages where used_at >= v_from and used_at < v_to), 0),
        'purchase_cost',  coalesce((select sum(quantity * unit_price) from public.restocks where created_at >= v_from and created_at < v_to), 0),
        'prev_usage_cost',    coalesce((select sum(quantity * unit_price) from public.usages where used_at >= v_prev_from and used_at < v_from), 0),
        'prev_purchase_cost', coalesce((select sum(quantity * unit_price) from public.restocks where created_at >= v_prev_from and created_at < v_from), 0),
        'usage_count',    (select count(*) from public.usage_batches where used_at >= v_from and used_at < v_to),
        'user_count',     (select count(distinct employee_id) from public.usage_batches where used_at >= v_from and used_at < v_to),
        'restock_count',  (select count(*) from public.restocks where created_at >= v_from and created_at < v_to))),
    'by_account_title', coalesce((
      select jsonb_agg(jsonb_build_object(
               'account_title_id', t.account_title_id,
               'account_title', coalesce(at.name, '（未設定）'),
               'usage_cost', t.usage_cost, 'purchase_cost', t.purchase_cost)
             order by coalesce(at.sort_order, 2147483647), coalesce(at.name, ''))
        from (select x.account_title_id, sum(x.usage_cost) as usage_cost, sum(x.purchase_cost) as purchase_cost
                from (select account_title_id, quantity * unit_price as usage_cost, 0::numeric as purchase_cost
                        from public.usages where used_at >= v_from and used_at < v_to
                      union all
                      select account_title_id, 0::numeric, quantity * unit_price
                        from public.restocks where created_at >= v_from and created_at < v_to) x
               group by x.account_title_id) t
        left join public.account_titles at on at.id = t.account_title_id), '[]'::jsonb),
    'by_item', coalesce((
      select jsonb_agg(r order by (r ->> 'usage_cost')::numeric desc, r ->> 'item_name')
        from (
          select jsonb_build_object(
            'item_id', i.id, 'item_name', i.name, 'unit', i.unit,
            'account_title', coalesce(at.name, '（未設定）'),
            'used_qty', coalesce(u.qty, 0), 'prev_used_qty', coalesce(pu.qty, 0),
            'usage_cost', coalesce(u.cost, 0),
            'restocked_qty', coalesce(rs.qty, 0), 'purchase_cost', coalesce(rs.cost, 0),
            'stock', i.stock, 'threshold', i.threshold,
            'avg_daily_use_30d', round(coalesce(d.qty, 0) / 30.0, 2),
            'days_to_empty', case when coalesce(d.qty, 0) > 0 then round(i.stock / (d.qty / 30.0), 1) end
          ) as r
            from public.items i
            left join public.account_titles at on at.id = i.account_title_id
            left join lateral (select sum(quantity) qty, sum(quantity * unit_price) cost from public.usages
                                where item_id = i.id and used_at >= v_from and used_at < v_to) u on true
            left join lateral (select sum(quantity) qty from public.usages
                                where item_id = i.id and used_at >= v_prev_from and used_at < v_from) pu on true
            left join lateral (select sum(quantity) qty, sum(quantity * unit_price) cost from public.restocks
                                where item_id = i.id and created_at >= v_from and created_at < v_to) rs on true
            left join lateral (select sum(quantity)::numeric qty from public.usages
                                where item_id = i.id and used_at >= v_rate_from and used_at < v_rate_to) d on true
           where i.is_active or u.qty is not null or rs.qty is not null
        ) s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- メール送信ワーカー向け RPC（service_role のみ）
-- ---------------------------------------------------------------------

create or replace function public.worker_claim_mail(p_limit integer default 20)
returns setof public.mail_outbox
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.mail_outbox m
     set status = 'sending', locked_at = now(), attempts = m.attempts + 1
   where m.id in (
     select o.id from public.mail_outbox o
      where (o.status = 'pending' and o.next_attempt_at <= now())
         or (o.status = 'sending' and o.locked_at < now() - interval '10 minutes')
      order by o.id
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning m.*;
end $$;

create or replace function public.worker_complete_mail(p_id bigint, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.mail_outbox
       set status = 'sent', sent_at = now(), last_error = null, locked_at = null
     where id = p_id;
  else
    update public.mail_outbox
       set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
           next_attempt_at = now() + make_interval(mins => power(2, least(attempts, 6))::integer),
           last_error = left(p_error, 1000),
           locked_at = null
     where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 管理画面用ビュー
-- ---------------------------------------------------------------------

create view public.v_usage_history with (security_invoker = true) as
select u.id, u.used_at, u.item_id, u.item_name, u.unit, u.quantity, u.unit_price,
       b.employee_no, b.employee_name, b.source, b.raw_text, u.batch_id
  from public.usages u
  join public.usage_batches b on b.id = u.batch_id;

-- ---------------------------------------------------------------------
-- 権限・RLS
-- ---------------------------------------------------------------------

alter table public.app_admins      enable row level security;
alter table public.account_titles  enable row level security;
alter table public.items           enable row level security;
alter table public.employees       enable row level security;
alter table public.usage_batches   enable row level security;
alter table public.usages          enable row level security;
alter table public.restocks        enable row level security;
alter table public.reminder_log    enable row level security;
alter table public.mail_outbox     enable row level security;
alter table public.app_settings    enable row level security;
alter table public.auth_failures   enable row level security;
alter table public.monthly_reports enable row level security;

-- anon はテーブルに直接アクセスさせない（RPC 経由のみ）
revoke all on all tables in schema public from anon;
revoke all on public.app_settings, public.auth_failures from authenticated;

-- マスタ：管理者は全操作可
create policy admin_all on public.account_titles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.items          for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.employees      for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 履歴類：管理者は参照のみ（登録は RPC 経由）
create policy admin_select on public.app_admins    for select to authenticated using (public.is_admin());
create policy admin_select on public.usage_batches for select to authenticated using (public.is_admin());
create policy admin_select on public.usages        for select to authenticated using (public.is_admin());
create policy admin_select on public.restocks      for select to authenticated using (public.is_admin());
create policy admin_select on public.reminder_log  for select to authenticated using (public.is_admin());
create policy admin_select on public.mail_outbox   for select to authenticated using (public.is_admin());
create policy admin_select on public.monthly_reports for select to authenticated using (public.is_admin());
create policy admin_insert on public.monthly_reports for insert to authenticated with check (public.is_admin());

revoke insert, update, delete on public.app_admins, public.usage_batches, public.usages, public.restocks,
  public.reminder_log, public.mail_outbox from authenticated;
revoke update, delete on public.monthly_reports from authenticated;

-- 関数：既定の実行権限を外して、必要なものだけ付与
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.kiosk_verify_device_key(text) to anon, authenticated;
grant execute on function public.kiosk_list_items(text) to anon, authenticated;
grant execute on function public.kiosk_lookup_employee(text, text) to anon, authenticated;
grant execute on function public.kiosk_use_items(text, uuid, text, jsonb, text, text) to anon, authenticated;

grant execute on function public.admin_restock(bigint, integer, numeric, text) to authenticated;
grant execute on function public.admin_set_device_key(text) to authenticated;
grant execute on function public.admin_device_key_status() to authenticated;
grant execute on function public.admin_clear_lockouts() to authenticated;
grant execute on function public.admin_run_daily_reminders() to authenticated;
grant execute on function public.admin_retry_mail(bigint) to authenticated;
grant execute on function public.admin_monthly_summary(date) to authenticated;

grant execute on function public.worker_claim_mail(integer) to service_role;
grant execute on function public.worker_complete_mail(bigint, boolean, text) to service_role;

grant select on public.v_usage_history to authenticated;
