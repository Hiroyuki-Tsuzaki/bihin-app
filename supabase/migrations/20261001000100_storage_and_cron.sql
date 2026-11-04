-- =====================================================================
-- 備品画像のストレージ、定期処理（pg_cron）
-- =====================================================================

-- 備品画像バケット（閲覧は公開URL、アップロード・削除は管理者のみ）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "item-images admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'item-images' and public.is_admin());

create policy "item-images admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'item-images' and public.is_admin());

create policy "item-images admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'item-images' and public.is_admin());

create policy "item-images admin select" on storage.objects
  for select to authenticated
  using (bucket_id = 'item-images' and public.is_admin());

-- ---------------------------------------------------------------------
-- 定期処理
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net を有効化できませんでした（テスト環境では無視してかまいません）: %', sqlerrm;
end $$;

-- send-mail Edge Function を呼ぶ。URL と秘密値は Vault に保存する:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-mail', 'mail_worker_url');
--   select vault.create_secret('<ランダムな長い文字列>', 'mail_worker_secret');
-- 未設定、または送る物がなければ何もしない
create or replace function private.invoke_mail_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
begin
  if not exists (
    select 1 from public.mail_outbox
     where (status = 'pending' and next_attempt_at <= now())
        or (status = 'sending' and locked_at < now() - interval '10 minutes')) then
    return;
  end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'mail_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mail_worker_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
end $$;

revoke execute on function private.invoke_mail_worker() from public, anon, authenticated;

-- 既存ジョブがあれば置き換え
select cron.unschedule(jobid) from cron.job where jobname in ('bihin-daily-reminder', 'bihin-mail-worker');

-- 毎日 00:00 UTC（= 09:00 JST）に補充依頼を登録
select cron.schedule('bihin-daily-reminder', '0 0 * * *', $$select private.run_daily_reminders()$$);

-- 毎分、送信待ちメールがあれば send-mail を起動
select cron.schedule('bihin-mail-worker', '* * * * *', $$select private.invoke_mail_worker()$$);
