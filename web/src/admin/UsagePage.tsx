import { useCallback, useEffect, useState } from 'react';
import { downloadText, jst, jstDate, toCsv } from '../lib/format';
import { supabase } from '../lib/supabase';

interface UsageRow {
  id: number;
  used_at: string;
  item_name: string;
  unit: string;
  quantity: number;
  employee_no: string;
  employee_name: string;
  source: string;
  raw_text: string | null;
}

export function UsagePage() {
  const today = jstDate();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const end = new Date(`${to}T00:00:00+09:00`);
    end.setDate(end.getDate() + 1);
    const { data } = await supabase.from('v_usage_history').select('*')
      .gte('used_at', `${from}T00:00:00+09:00`).lt('used_at', end.toISOString())
      .order('used_at', { ascending: false }).limit(2000);
    setRows((data ?? []) as UsageRow[]);
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const shown = rows.filter((r) => !q || r.item_name.includes(q) || r.employee_no.includes(q) || r.employee_name.includes(q));

  function exportCsv() {
    downloadText(`利用状況_${from}_${to}.csv`, toCsv([
      ['登録日時', '備品名', '使用数量', '単位', '社員番号', '氏名', '入力方法'],
      ...shown.map((r) => [jst(r.used_at), r.item_name, r.quantity, r.unit, r.employee_no, r.employee_name, r.source === 'natural_language' ? 'AI（文章）' : '一覧']),
    ]));
  }

  return (
    <div className="stack">
      <h1>利用状況一覧</h1>
      <div className="row wrap">
        <label className="inline">期間 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">〜 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <input placeholder="備品名・社員番号・氏名で絞り込み" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={exportCsv} disabled={shown.length === 0}>CSV出力</button>
      </div>
      {loading ? <p className="muted">読み込み中…</p> : (
        <table className="table">
          <thead><tr><th>登録日時</th><th>備品名</th><th>使用数量</th><th>社員番号</th><th>氏名</th><th>入力</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{jst(r.used_at)}</td><td>{r.item_name}</td><td>{r.quantity}{r.unit}</td><td>{r.employee_no}</td><td>{r.employee_name}</td>
                <td title={r.raw_text ?? ''}>{r.source === 'natural_language' ? <span className="badge badge-ai">AI</span> : '一覧'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">{shown.length}件　※社員番号は自己申告であり、本人確認済みの記録ではありません。</p>
    </div>
  );
}
