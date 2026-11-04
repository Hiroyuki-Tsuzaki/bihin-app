import { assert, assertEquals } from '../_shared/assert_test_helper.ts';
import { callClaudeTool } from '../_shared/claude.ts';
import { buildParsePrompt, type KioskItem, normalizeParseResult, PARSE_TOOL } from './parse.ts';

const items: KioskItem[] = [
  { id: 1, name: 'コピー用紙 A4（500枚）', unit: '冊', stock: 20 },
  { id: 5, name: '単3乾電池', unit: '本', stock: 3 },
];

Deno.test('正しい出力を備品名・単位・在庫付きに正規化する', () => {
  const r = normalizeParseResult({ lines: [{ item_id: 1, quantity: 2 }, { item_id: 5, quantity: 4 }], unmatched: [] }, items);
  assertEquals(r.lines, [
    { item_id: 1, item_name: 'コピー用紙 A4（500枚）', unit: '冊', quantity: 2, stock: 20, insufficient: false },
    { item_id: 5, item_name: '単3乾電池', unit: '本', quantity: 4, stock: 3, insufficient: true },
  ]);
});

Deno.test('存在しないID・不正な数量は除外し、同じ備品は合算する', () => {
  const r = normalizeParseResult({
    lines: [{ item_id: 99, quantity: 1 }, { item_id: 1, quantity: 0 }, { item_id: 5, quantity: 1.5 }, { item_id: 1, quantity: 1 }, { item_id: 1, quantity: 2 }],
    unmatched: ['ホッチキス'],
    note: '  ',
  }, items);
  assertEquals(r.lines.map((l) => [l.item_id, l.quantity]), [[1, 3]]);
  assertEquals(r.unmatched.length, 4);
  assertEquals(r.unmatched[0], 'ホッチキス');
  assertEquals(r.note, undefined);
});

Deno.test('壊れた出力でも例外にしない', () => {
  assertEquals(normalizeParseResult(null, items), { lines: [], unmatched: [], note: undefined });
  assertEquals(normalizeParseResult({ lines: 'x' }, items).lines, []);
});

Deno.test('プロンプトに備品リストと入力文を含め、価格等は含めない', () => {
  const { system, user } = buildParsePrompt('単三2本', items);
  assert(system.includes('record_usage'));
  assert(user.includes('"id":5') && user.includes('<input>単三2本</input>'));
  assert(!user.includes('stock'));
});

Deno.test('Claude API をツール強制で呼び、tool_use の input を返す', async () => {
  let sent: Record<string, unknown> = {};
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'record_usage', input: { lines: [{ item_id: 5, quantity: 2 }], unmatched: [] } }] }));
  }) as unknown as typeof fetch;
  const out = await callClaudeTool({ apiKey: 'k', model: 'test-model', system: 's', user: 'u', fetchImpl: fakeFetch }, PARSE_TOOL);
  assertEquals(out, { lines: [{ item_id: 5, quantity: 2 }], unmatched: [] });
  assertEquals(sent.model, 'test-model');
  assertEquals(sent.tool_choice, { type: 'tool', name: 'record_usage' });
});
