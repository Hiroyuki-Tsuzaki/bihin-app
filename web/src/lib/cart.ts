// 受取する備品の選択状態（画面から切り離した純粋関数）
export type Cart = Record<number, number>;

export interface CartLine {
  item_id: number;
  quantity: number;
}

export function setQuantity(cart: Cart, itemId: number, quantity: number): Cart {
  const next = { ...cart };
  if (!Number.isInteger(quantity) || quantity <= 0) delete next[itemId];
  else next[itemId] = quantity;
  return next;
}

export function increment(cart: Cart, itemId: number, delta: number): Cart {
  return setQuantity(cart, itemId, (cart[itemId] ?? 0) + delta);
}

export function toLines(cart: Cart): CartLine[] {
  return Object.entries(cart)
    .map(([id, q]) => ({ item_id: Number(id), quantity: q }))
    .filter((l) => l.quantity > 0)
    .sort((a, b) => a.item_id - b.item_id);
}

export function fromLines(lines: CartLine[]): Cart {
  return lines.reduce<Cart>((c, l) => increment(c, l.item_id, l.quantity), {});
}

/** 入力文字列を正の整数に変換。不正なら null */
export function parsePositiveInt(input: string): number | null {
  const s = input.trim().replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 2147483647 ? n : null;
}

export function normalizeEmployeeNo(input: string): string {
  return input.trim().replace(/[０-９Ａ-Ｚａ-ｚ]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}
