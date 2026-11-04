import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { jst, yen } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { Item } from './types';
import { errMsg } from './useAdmin';

interface Restock {
  id: number;
  item_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  stock_before: number;
  stock_after: number;
  note: string | null;
  created_by_email: string | null;
  created_at: string;
}

interface RestockResult {
  item_name: string;
  unit: string;
  quantity: number;
  stock_before: number;
  stock_after: number;
  threshold: number;
  above_threshold: boolean;
}

export function RestockPage() {
  const [params] = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<Restock[]>([]);
  const [itemId, setItemId] = useState<number | ''>(params.get('item') ? Number(params.get('item')) : '');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<RestockResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: i }, { data: h }] = await Promise.all([
      supabase.from('items').select('*').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('restocks').select('*').order('created_at', { ascending: false }).limit(30),
    ]);
    setItems((i ?? []) as Item[]);
    setHistory((h ?? []) as Restock[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const item = items.find((i) => i.id === itemId);
  useEffect(() => {
    if (item) setPrice(String(item.unit_price));
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    const q = Number(qty);
    const p = Number(price);
    if (!item) return setError('備品を選択してください');
    if (!Number.isInteger(q) || q <= 0) return setError('補充数は1以上の整数で入力してください');
    if (price === '' || !(p >= 0)) return setError('購入単価（税抜）は0以上で入力してください');
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_restock', { p_item_id: item.id, p_quantity: q, p_unit_price: p, p_note: note || null });
    setBusy(false);
    if (error) return setError(errMsg(error));
    setResult(data as RestockResult);
    setQty('');
    setNote('');
    load();
  }

  return (
    <div className="stack">
      <h1>補充登録</h1>
      <form className="panel form-grid" onSubmit={submit}>
        <label className="span2">備品
          <select value={itemId} onChange={(e) => { setItemId(e.target.value ? Number(e.target.value) : ''); setResult(null); }}>
            <option value="">選択してください</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}（在庫 {i.stock}{i.unit} / しきい値 {i.threshold}{i.unit}）</option>)}
          </select>
        </label>
        <label>補充数{item && `（${item.unit}）`}<input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label>購入単価（税抜・1{item?.unit ?? '個'}あたり）<input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="span2">メモ（購入先など・任意）<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {item && qty && Number(qty) > 0 && price !== '' && (
          <p className="muted span2">登録後の在庫：{item.stock + Number(qty)}{item.unit}　購入金額（税抜）：{yen(Number(qty) * Number(price))}</p>
        )}
        {error && <div className="alert alert-error span2">{error}</div>}
        <div className="row end span2"><button className="btn btn-primary btn-lg" disabled={busy}>{busy ? '登録中…' : '補充を登録'}</button></div>
      </form>

      {result && (
        <div className="alert alert-success">
          <div>「{result.item_name}」を {result.quantity}{result.unit} 補充しました。</div>
          <div className="big">更新後の在庫数：<strong>{result.stock_after}{result.unit}</strong>（補充前 {result.stock_before}{result.unit} ／ しきい値 {result.threshold}{result.unit}）</div>
          <div>{result.above_threshold
            ? 'しきい値を上回ったため、翌日以降の補充依頼メールは停止します。'
            : 'まだしきい値以下のため、翌日以降も毎日9:00に補充依頼メールが送られます。'}</div>
        </div>
      )}

      <section className="panel">
        <h2>最近の補充</h2>
        <table className="table">
          <thead><tr><th>日時</th><th>備品</th><th>補充数</th><th>単価（税抜）</th><th>金額</th><th>在庫</th><th>登録者</th><th>メモ</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{jst(h.created_at)}</td><td>{h.item_name}</td><td>{h.quantity}{h.unit}</td><td>{yen(h.unit_price)}</td>
                <td>{yen(h.quantity * h.unit_price)}</td><td>{h.stock_before}→{h.stock_after}</td><td className="small">{h.created_by_email}</td><td className="small">{h.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
