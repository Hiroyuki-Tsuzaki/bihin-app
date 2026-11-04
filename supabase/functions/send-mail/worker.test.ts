import { assertEquals } from '../_shared/assert_test_helper.ts';
import type { Mailer } from '../_shared/mailer.ts';
import { type OutboxRow, processOutbox } from './worker.ts';

const rows: OutboxRow[] = [
  { id: 1, to_address: 'a@example.com', subject: 's1', body: 'b1', attempts: 1, max_attempts: 5 },
  { id: 2, to_address: 'bad@example.com', subject: 's2', body: 'b2', attempts: 1, max_attempts: 5 },
  { id: 3, to_address: 'c@example.com', subject: 's3', body: 'b3', attempts: 1, max_attempts: 5 },
];

Deno.test('送信成功・失敗をそれぞれ Outbox に記録し、失敗しても残りを送る', async () => {
  const completed: Array<[number, boolean, string | undefined]> = [];
  const sentTo: string[] = [];
  const store = { claim: () => Promise.resolve(rows), complete: (id: number, ok: boolean, e?: string) => { completed.push([id, ok, e]); return Promise.resolve(); } };
  const mailer: Mailer = {
    send: (m) => m.to.startsWith('bad') ? Promise.reject(new Error('550 rejected')) : (sentTo.push(m.to), Promise.resolve()),
    close: () => Promise.resolve(),
  };
  const sleeps: number[] = [];
  const result = await processOutbox(store, mailer, { delayMs: 500, sleep: (ms) => (sleeps.push(ms), Promise.resolve()) });

  assertEquals(result, { claimed: 3, sent: 2, failed: 1 });
  assertEquals(sentTo, ['a@example.com', 'c@example.com']);
  assertEquals(completed, [[1, true, undefined], [2, false, '550 rejected'], [3, true, undefined]]);
  assertEquals(sleeps, [500, 500], '1通ごとに間隔をあける');
});

Deno.test('送信待ちがなければ何もしない', async () => {
  const store = { claim: () => Promise.resolve([]), complete: () => Promise.reject(new Error('呼ばれない')) };
  const mailer: Mailer = { send: () => Promise.reject(new Error('呼ばれない')), close: () => Promise.resolve() };
  assertEquals(await processOutbox(store, mailer), { claimed: 0, sent: 0, failed: 0 });
});
