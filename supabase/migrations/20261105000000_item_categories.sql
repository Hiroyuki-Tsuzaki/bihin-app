-- =====================================================================
-- 備品カテゴリ（利用画面のタブ）
--   * カテゴリは管理者が編集できるマスタ
--   * 備品1つにカテゴリ1つ（未設定も可。未設定の備品は「すべて」タブにだけ表示）
-- =====================================================================

create table public.item_categories (
  id          bigint generated always as identity primary key,
  name        text not null unique check (length(btrim(name)) > 0),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger item_categories_touch before update on public.item_categories
  for each row execute function private.touch_updated_at();

-- 初期カテゴリ
insert into public.item_categories (name, sort_order) values
  ('コピー用紙', 1),
  ('封筒',       2),
  ('文房具',     3),
  ('家電',       4),
  ('飲み物',     5)
on conflict (name) do nothing;

-- 備品にカテゴリを追加（カテゴリを削除した場合は未設定に戻す）
alter table public.items
  add column category_id bigint references public.item_categories(id) on delete set null;
create index items_category_idx on public.items (category_id);

-- 権限：管理者は全操作可、利用端末（anon）は直接アクセス不可
alter table public.item_categories enable row level security;
create policy admin_all on public.item_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.item_categories from anon;

-- 利用端末向けの備品一覧：カテゴリ情報を追加（価格などは引き続き返さない）
create or replace function public.kiosk_list_items(p_device_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_status text := private.check_device_key(p_device_key);
begin
  if v_status <> 'ok' then
    return private.device_key_error(v_status);
  end if;
  return jsonb_build_object(
    'ok', true,
    -- タブに表示する有効なカテゴリ（「すべて」は画面側で付与）
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
        from public.item_categories c where c.is_active), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'name', i.name, 'unit', i.unit, 'image_path', i.image_path,
               'stock', i.stock, 'low', i.stock <= i.threshold,
               -- 無効なカテゴリに属する備品は「未設定」として扱う
               'category_id', case when c.is_active then c.id end,
               'category_name', case when c.is_active then c.name end)
             order by i.sort_order, i.name)
        from public.items i
        left join public.item_categories c on c.id = i.category_id
       where i.is_active), '[]'::jsonb));
end $$;

revoke execute on function public.kiosk_list_items(text) from public;
grant execute on function public.kiosk_list_items(text) to anon, authenticated;
