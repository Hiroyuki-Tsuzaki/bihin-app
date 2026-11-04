// Outbox のメールを送る処理（DB・送信手段を差し替えてテストできるよう分離）
import type { Mailer } from '../_shared/mailer.ts';

export interface OutboxRow {
  id: number;
  to_address: string;
  subject: string;
  body: string;
  attempts: number;
  max_attempts: number;
}

export interface OutboxStore {
  claim(limit: number): Promise<OutboxRow[]>;
  complete(id: number, ok: boolean, error?: string): Promise<void>;
}

export interface ProcessOptions {
  limit?: number;
  /** Gmail の送信制限対策：1通ごとの間隔 */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function processOutbox(store: OutboxStore, mailer: Mailer, opts: ProcessOptions = {}) {
  const limit = opts.limit ?? 20;
  const delayMs = opts.delayMs ?? 1000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rows = await store.claim(limit);
  let sent = 0;
  let failed = 0;
  for (const [i, row] of rows.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    try {
      await mailer.send({ to: row.to_address, subject: row.subject, text: row.body });
      await store.complete(row.id, true);
      sent++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[send-mail] id=${row.id} 送信失敗: ${message}`);
      // 失敗は Outbox に記録するだけ。在庫・履歴には一切触れない
      await store.complete(row.id, false, message);
    }
  }
  return { claimed: rows.length, sent, failed };
}
