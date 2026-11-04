// pg_cron から毎分呼ばれ、mail_outbox の送信待ちメールを送る
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight, requireEnv, safeEqual } from '../_shared/http.ts';
import { createMailerFromEnv } from '../_shared/mailer.ts';
import { type OutboxRow, processOutbox } from './worker.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const secret = Deno.env.get('MAIL_WORKER_SECRET');
  const given = req.headers.get('x-worker-secret') ?? '';
  if (!secret || !safeEqual(given, secret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const db = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });
    const mailer = await createMailerFromEnv(Deno.env.toObject());
    const store = {
      async claim(limit: number) {
        const { data, error } = await db.rpc('worker_claim_mail', { p_limit: limit });
        if (error) throw error;
        return (data ?? []) as OutboxRow[];
      },
      async complete(id: number, ok: boolean, message?: string) {
        const { error } = await db.rpc('worker_complete_mail', { p_id: id, p_ok: ok, p_error: message ?? null });
        if (error) console.error(`[send-mail] 結果の記録に失敗 id=${id}: ${error.message}`);
      },
    };
    const result = await processOutbox(store, mailer, {
      limit: Number(Deno.env.get('MAIL_BATCH_SIZE') ?? '20'),
      delayMs: Number(Deno.env.get('MAIL_SEND_INTERVAL_MS') ?? '1000'),
    });
    await mailer.close();
    return json({ ok: true, ...result });
  } catch (e) {
    console.error('[send-mail]', e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
