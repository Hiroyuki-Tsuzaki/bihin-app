// 月次レポートのプロンプト組み立て
export interface MonthlyStats {
  month: string;
  totals: Record<string, number>;
  by_account_title: Array<{ account_title: string; usage_cost: number; purchase_cost: number }>;
  by_item: Array<{
    item_name: string;
    unit: string;
    account_title: string;
    used_qty: number;
    prev_used_qty: number;
    usage_cost: number;
    restocked_qty: number;
    purchase_cost: number;
    stock: number;
    threshold: number;
    avg_daily_use_30d: number;
    days_to_empty: number | null;
  }>;
}

export const yen = (v: number) => `${Math.round(Number(v)).toLocaleString('ja-JP')}円`;

export function isValidMonth(m: unknown): m is string {
  return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

export function buildReportPrompt(stats: MonthlyStats) {
  const system = [
    'あなたは総務部門の備品管理担当者として、経営陣・部門長向けの月次報告を書きます。',
    '与えられた集計データ(JSON)だけを根拠に、日本語の Markdown で簡潔にまとめてください。データにない数値や推測の事実は書かないこと。',
    '金額は税抜・円。「使用ベース」は社員が使った月に計上した金額、「購入ベース」は補充（購入）した月に計上した金額で、会計上の消耗品費は購入ベースが一般的です。',
    '構成:',
    '## 概況（3行以内）',
    '## 費用（仕訳別）… 使用ベースと購入ベースを並べ、前月との比較に触れる',
    '## 備品の増減傾向 … 使用数が前月から大きく増減した備品、補充が多かった備品',
    '## 注意が必要な備品 … しきい値以下、または在庫切れまでの日数（days_to_empty）が短い備品',
    '## 来月に向けた提案（2〜3項目）… 発注量・しきい値の見直しなど',
    '全体で600字程度。表は使わず箇条書きで。',
  ].join('\n');
  const user = `対象月: ${stats.month}\n集計データ(JSON):\n${JSON.stringify(stats)}`;
  return { system, user };
}
