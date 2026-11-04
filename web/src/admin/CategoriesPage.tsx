import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ItemCategory } from './types';
import { errMsg } from './useAdmin';

export function CategoriesPage() {
  const [rows, setRows] = useState<ItemCategory[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [editing, setEditing] = useState<(Omit<ItemCategory, 'id'> & { id?: number }) | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [{ data }, { data: items }] = await Promise.all([
      supabase.from('item_categories').select('*').order('sort_order').order('name'),
      supabase.from('items').select('category_id').eq('is_active', true),
    ]);
    setRows((data ?? []) as ItemCategory[]);
    const c: Record<number, number> = {};
    for (const i of (items ?? []) as Array<{ category_id: number | null }>) if (i.category_id != null) c[i.category_id] = (c[i.category_id] ?? 0) + 1;
    setCounts(c);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { id, ...f } = editing;
    const row = { name: f.name.trim(), sort_order: Number(f.sort_order) || 0, is_active: f.is_active };
    const { error } = id ? await supabase.from('item_categories').update(row).eq('id', id) : await supabase.from('item_categories').insert(row);
    if (error) return setError(/duplicate key/.test(error.message) ? 'そのカテゴリ名はすでに登録されています' : errMsg(error));
    setMsg(`「${row.name}」を保存しました`);
    setEditing(null);
    setError('');
    load();
  }

  async function remove(c: ItemCategory) {
    const n = counts[c.id] ?? 0;
    if (!window.confirm(`カテゴリ「${c.name}」を削除しますか？${n > 0 ? `\n割り当て済みの備品${n}件は「未設定」になります。` : ''}`)) return;
    const { error } = await supabase.from('item_categories').delete().eq('id', c.id);
    if (error) return setError(errMsg(error));
    setMsg(`「${c.name}」を削除しました`);
    load();
  }

  return (
    <div className="stack">
      <div className="row between">
        <h1>カテゴリマスタ</h1>
        <button className="btn btn-primary" onClick={() => { setEditing({ name: '', sort_order: rows.length + 1, is_active: true }); setError(''); setMsg(''); }}>＋ カテゴリを追加</button>
      </div>
      <p className="muted">利用画面の上部に表示するタブです。表示順の小さい順に並び、「すべて」は常に先頭に表示されます。無効にしたカテゴリはタブに表示されず、その備品は「すべて」にだけ表示されます。</p>
      {msg && <div className="alert alert-success">{msg}</div>}
      {editing && (
        <form className="panel form-grid" onSubmit={save}>
          <h2 className="span2">{editing.id ? 'カテゴリの編集' : 'カテゴリの追加'}</h2>
          <label>カテゴリ名<input required maxLength={20} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label>表示順<input type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> 有効（利用画面にタブを表示）</label>
          {error && <div className="alert alert-error span2">{error}</div>}
          <div className="row end span2">
            <button type="button" className="btn" onClick={() => setEditing(null)}>キャンセル</button>
            <button className="btn btn-primary">保存</button>
          </div>
        </form>
      )}
      {!editing && error && <div className="alert alert-error">{error}</div>}
      <table className="table">
        <thead><tr><th>表示順</th><th>カテゴリ名</th><th className="num">備品数</th><th>状態</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.is_active ? '' : 'row-muted'}>
              <td>{r.sort_order}</td><td>{r.name}</td><td className="num">{counts[r.id] ?? 0}</td><td>{r.is_active ? '有効' : '無効'}</td>
              <td className="row end">
                <button className="btn btn-small" onClick={() => { setEditing({ ...r }); setError(''); setMsg(''); }}>編集</button>
                <button className="btn btn-small btn-danger" onClick={() => remove(r)}>削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
