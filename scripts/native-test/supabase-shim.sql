-- Docker を使わずに素の PostgreSQL でマイグレーションとテストを流すための最小限のスタブ。
-- 本番・supabase CLI 環境では使いません。
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;
create schema if not exists net;
grant usage on schema extensions, auth, storage to anon, authenticated, service_role;

create table if not exists auth.users (id uuid primary key, email text);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;

create table if not exists vault.secrets_store (name text primary key, decrypted_secret text);
create or replace view vault.decrypted_secrets as select name, decrypted_secret from vault.secrets_store;

create table if not exists net.calls (id bigserial primary key, url text, headers jsonb, body jsonb, called_at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint
language sql as $$ insert into net.calls(url, headers, body) values (url, headers, body) returning id $$;

create extension if not exists pgtap with schema extensions;

-- Supabase と同様、既定で anon / authenticated に public のテーブル権限を付与
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create or replace function vault.create_secret(new_secret text, new_name text) returns uuid
language sql as $$ insert into vault.secrets_store(name, decrypted_secret) values (new_name, new_secret)
  on conflict (name) do update set decrypted_secret = excluded.decrypted_secret returning gen_random_uuid() $$;
