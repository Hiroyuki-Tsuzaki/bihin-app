import { describe, expect, it } from 'vitest';
import { increment } from './cart';
import { ALL, filterByCategory, normalizeTab, selectedCountByCategory } from './categories';

const items = [
  { id: 1, category_id: 10 },
  { id: 2, category_id: 20 },
  { id: 3, category_id: null },
  { id: 4, category_id: 20 },
];

describe('カテゴリタブ', () => {
  it('「すべて」は未設定を含む全件、カテゴリ指定はそのカテゴリだけ', () => {
    expect(filterByCategory(items, ALL).map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect(filterByCategory(items, 20).map((i) => i.id)).toEqual([2, 4]);
    expect(filterByCategory(items, 99)).toEqual([]);
  });

  it('カテゴリを切り替えても選択個数は備品ごとに保持される', () => {
    let cart = increment({}, 1, 2); // カテゴリ10で2個
    const shown = filterByCategory(items, 20); // カテゴリ20に切り替え
    cart = increment(cart, shown[0].id, 1); // カテゴリ20で1個
    expect(cart).toEqual({ 1: 2, 2: 1 }); // 切り替え前の個数が残る
  });

  it('タブのバッジ件数（品目数）', () => {
    const counts = selectedCountByCategory(items, { 1: 2, 2: 1, 3: 5 });
    expect(counts.get(ALL)).toBe(3);
    expect(counts.get(10)).toBe(1);
    expect(counts.get(20)).toBe(1);
  });

  it('存在しないタブは「すべて」に戻す', () => {
    expect(normalizeTab(20, [{ id: 20, name: 'x' }])).toBe(20);
    expect(normalizeTab(30, [{ id: 20, name: 'x' }])).toBe(ALL);
  });
});
