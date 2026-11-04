// 利用画面のカテゴリタブ（画面から切り離した純粋関数）
import type { Cart } from './cart';

export const ALL = 'all' as const;
export type CategoryTab = typeof ALL | number;

export interface CategoryLike {
  id: number;
  name: string;
}

export interface ItemLike {
  id: number;
  category_id: number | null;
}

/** タブで表示する備品。「すべて」は未設定の備品も含めて全件 */
export function filterByCategory<T extends ItemLike>(items: T[], tab: CategoryTab): T[] {
  return tab === ALL ? items : items.filter((i) => i.category_id === tab);
}

/** カテゴリごとの選択中の品目数（タブのバッジ用）。キー ALL は全体の品目数 */
export function selectedCountByCategory(items: ItemLike[], cart: Cart): Map<CategoryTab, number> {
  const counts = new Map<CategoryTab, number>();
  for (const item of items) {
    if ((cart[item.id] ?? 0) <= 0) continue;
    counts.set(ALL, (counts.get(ALL) ?? 0) + 1);
    if (item.category_id != null) counts.set(item.category_id, (counts.get(item.category_id) ?? 0) + 1);
  }
  return counts;
}

/** 選択中のタブが無くなった（カテゴリ無効化など）場合は「すべて」に戻す */
export function normalizeTab(tab: CategoryTab, categories: CategoryLike[]): CategoryTab {
  return tab === ALL || categories.some((c) => c.id === tab) ? tab : ALL;
}
