import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useCallback, useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { currentMonth, jst, yen } from '../lib/format';
import { supabase } from '../lib/supabase';
import { errMsg } from './useAdmin';

interface Summary {
  month: string;
  totals: { usage_cost: number; purchase_cost: number; prev_usage_cost: number; prev_purchase_cost: number; usage_count: number; user_count: number; restock_count: number };
  by_account_title: Array<{ account_title: string; usage_cost: number; purchase_cost: number }>;
  by_item: Array<{
    item_id: number; item_name: string; unit: string; account_title: string; used_qty: number; prev_used_qty: number;
    usage_cost: number; restocked_qty: number; purchase_cost: number; stock: number; threshold: number; days_to_empty: number | null;
  }>;
}

interface Report { id: number; content: string; model: string | null; created_at: string; created_by_email: string | null }

const diff = (now: number, prev: number) => {
  const d = now - prev;
  if (d === 0) return <span className="muted">±0</span>;
  return <span className={d > 0 ? 'up' : 'down'}>{d > 0 ? '+' : ''}{d}</span>;
};

export function ReportPage() {
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [shown, setShown] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    const [{ data, error }, { data: r }] = await Promise.all([
      supabase.rpc('admin_monthly_summary', { p_month: `${month}-01` }),
      supabase.from('monthly_reports').select('id, content, model, created_at, created_by_email').eq('target_month', `${month}-01`).order('created_at', { ascending: false }),
    ]);
    if (error) setError(errMsg(error));
    setSummary(data as Summary);
    setReports((r ?? []) as Report[]);
    setShown(((r ?? []) as Report[])[0] ?? null);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  async function generate() {
    setBusy(true);
    setError('');
    const { data, error } = await supabase.functions.invoke('monthly-report', { body: { month } });
    setBusy(false);
    if (error) {
      let m = 'レポートの生成に失敗しました';
      if (error instanceof FunctionsHttpError) {
        try { m += `：${(await error.context.json()).message ?? ''}`; } catch { /* noop */ }
      }
      return setError(m);
    }
    await load();
    setShown({ id: data.id, content: data.content, model: data.model, created_at: data.created_at, created_by_email: null });
  }

  const t = summary?.totals;
  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>月次レポート</h1>
        <div className="row">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn btn-primary" onClick={generate} disabled={busy}>{busy ? 'AIが作成中…（30秒ほど）' : 'AIレポートを生成'}</button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {t && (
        <div className="kpis">
          <div className="kpi"><div className="kpi-label">使用ベース費用（税抜）</div><div className="kpi-value">{yen(t.usage_cost)}</div><div className="small muted">前月 {yen(t.prev_usage_cost)}</div></div>
          <div className="kpi"><div className="kpi-label">購入ベース費用（税抜）</div><div className="kpi-value">{yen(t.purchase_cost)}</div><div className="small muted">前月 {yen(t.prev_purchase_cost)}</div></div>
          <div className="kpi"><div className="kpi-label">受取回数 / 利用者数</div><div className="kpi-value">{t.usage_count}<small>回</small> / {t.user_count}<small>人</small></div></div>
          <div className="kpi"><div className="kpi-label">補充回数</div><div className="kpi-value">{t.restock_count}<small>回</small></div></div>
        </div>
      )}

      {summary && (
        <section className="panel">
          <h2>仕訳別の費用（税抜）</h2>
          <p className="muted small">使用ベース＝社員が使った月に計上 ／ 購入ベース＝補充（購入）した月に実購入単価で計上（会計上の消耗品費は一般に購入ベース）</p>
          <table className="table">
            <thead><tr><th>仕訳</th><th className="num">使用ベース</th><th className="num">購入ベース</th></tr></thead>
            <tbody>
              {summary.by_account_title.map((a) => (
                <tr key={a.account_title}><td>{a.account_title}</td><td className="num">{yen(a.usage_cost)}</td><td className="num">{yen(a.purchase_cost)}</td></tr>
              ))}
              {summary.by_account_title.length === 0 && <tr><td colSpan={3} className="muted">この月の利用・補充はありません</td></tr>}
            </tbody>
            <tfoot><tr><th>合計</th><th className="num">{yen(t?.usage_cost)}</th><th className="num">{yen(t?.purchase_cost)}</th></tr></tfoot>
          </table>
        </section>
      )}

      {summary && (
        <section className="panel">
          <h2>備品別の増減</h2>
          <table className="table">
            <thead><tr><th>備品</th><th>仕訳</th><th className="num">使用数</th><th className="num">前月比</th><th className="num">使用ベース</th><th className="num">補充数</th><th className="num">購入ベース</th><th className="num">現在庫</th><th className="num">在庫切れ予測</th></tr></thead>
            <tbody>
              {summary.by_item.map((i) => (
                <tr key={i.item_id}>
                  <td>{i.item_name}</td><td className="small">{i.account_title}</td>
                  <td className="num">{i.used_qty}{i.unit}</td><td className="num">{diff(i.used_qty, i.prev_used_qty)}</td>
                  <td className="num">{yen(i.usage_cost)}</td><td className="num">{i.restocked_qty}{i.unit}</td><td className="num">{yen(i.purchase_cost)}</td>
                  <td className={`num ${i.stock <= i.threshold ? 'warn' : ''}`}>{i.stock}{i.unit}</td>
                  <td className="num">{i.days_to_empty == null ? '—' : `約${Math.floor(i.days_to_empty)}日`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">在庫切れ予測は直近30日の平均使用数から計算しています。</p>
        </section>
      )}

      <section className="panel">
        <div className="row between wrap">
          <h2><span className="badge badge-ai">AI</span> 報告用サマリー</h2>
          {reports.length > 1 && (
            <select value={shown?.id ?? ''} onChange={(e) => setShown(reports.find((r) => r.id === Number(e.target.value)) ?? null)}>
              {reports.map((r) => <option key={r.id} value={r.id}>{jst(r.created_at)} 生成</option>)}
            </select>
          )}
        </div>
        {shown ? (
          <>
            <div className="markdown" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(shown.content, { async: false })) }} />
            <p className="muted small">{jst(shown.created_at)} 生成{shown.model ? `（${shown.model}）` : ''}　※AIが集計データをもとに作成した文章です。数値は上の表で確認してください。</p>
          </>
        ) : <p className="muted">まだ生成されていません。「AIレポートを生成」を押してください。</p>}
      </section>
    </div>
  );
}
