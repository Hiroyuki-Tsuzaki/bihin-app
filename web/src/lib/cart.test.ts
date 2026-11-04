import { describe, expect, it } from 'vitest';
import { fromLines, increment, normalizeEmployeeNo, parsePositiveInt, setQuantity, toLines } from './cart';

describe('cart', () => {
  it('数量の加減と0以下での削除', () => {
    let c = increment({}, 3, 1);
    c = increment(c, 3, 2);
    expect(c).toEqual({ 3: 3 });
    c = increment(c, 3, -3);
    expect(c).toEqual({});
  });
  it('不正な数量は削除扱い', () => {
    expect(setQuantity({ 1: 2 }, 1, 1.5)).toEqual({});
  });
  it('明細への変換はID順・合算', () => {
    expect(toLines({ 5: 1, 2: 3 })).toEqual([{ item_id: 2, quantity: 3 }, { item_id: 5, quantity: 1 }]);
    expect(fromLines([{ item_id: 1, quantity: 1 }, { item_id: 1, quantity: 2 }])).toEqual({ 1: 3 });
  });
});

describe('入力チェック', () => {
  it('正の整数のみ（全角数字も可）', () => {
    expect(parsePositiveInt('3')).toBe(3);
    expect(parsePositiveInt('１２')).toBe(12);
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-1')).toBeNull();
    expect(parsePositiveInt('1.5')).toBeNull();
    expect(parsePositiveInt('abc')).toBeNull();
  });
  it('社員番号の全角→半角', () => {
    expect(normalizeEmployeeNo(' １００１ ')).toBe('1001');
  });
});
