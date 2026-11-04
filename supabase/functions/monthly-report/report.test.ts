import { assert, assertEquals } from '../_shared/assert_test_helper.ts';
import { buildReportPrompt, isValidMonth, yen } from './report.ts';

Deno.test('月の形式チェック', () => {
  assert(isValidMonth('2026-09'));
  assert(!isValidMonth('2026-13'));
  assert(!isValidMonth('2026/09'));
  assert(!isValidMonth(202609));
});

Deno.test('金額表示', () => {
  assertEquals(yen(1234.5), '1,235円');
});

Deno.test('プロンプトに使用ベース/購入ベースの定義と集計値を含む', () => {
  const stats = {
    month: '2026-09',
    totals: { usage_cost: 1100, purchase_cost: 2800 },
    by_account_title: [{ account_title: '事務用品費', usage_cost: 900, purchase_cost: 2800 }],
    by_item: [],
  };
  const { system, user } = buildReportPrompt(stats);
  assert(system.includes('使用ベース') && system.includes('購入ベース'));
  assert(user.includes('2026-09') && user.includes('"purchase_cost":2800'));
});
