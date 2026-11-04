import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AccountTitle } from './types';
import { errMsg } from './useAdmin';

export function AccountTitlesPage() {
  const [rows, setRows] = useState<AccountTitle[]>([]);
  const [editing, setEditing] = useState<(Omit<AccountTitle, 'id'> & { id?: number }) | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('account_titles').select('*').order('sort_order').order('name');
    setRows((data ?? []) as AccountTitle[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { id, ...f } = editing;
    const row = { name: f.name.trim(), code: f.code?.trim() || null, sort_order: Number(f.sort_order) || 0, is_active: f.is_active };
    const { error } = id ? await supabase.from('account_titles').update(row).eq('id', id) : await supabase.from('account_titles').insert(row);
    if (error) return setError(errMsg(error));
    setEditing(null);
    setError('');
    load();
  }

  return (
    <div className="stack">
      <div className="row between">
        <h1>仕訳マスタ</h1>
        <button className="btn btn-primary" onClick={() => { setEditing({ name: '', code: '', sort_order: rows.length + 1, is_active: true }); setError(''); }}>＋ 仕訳を追加</button>
      </div>
      <p className="muted">備品マスタで選択する仕訳項目です（例：事務用品費、消耗品費）。月次レポートの費用はこの項目ごとに集計されます。</p>
      {editing && (
        <form className="panel form-grid" onSubmit={save}>
          <label>仕訳名<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label>勘定科目コード（任意）<input value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></label>
          <label>表示順<input type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> 有効</label>
          {error && <div className="alert alert-error span2">{error}</div>}
          <div className="row end span2">
            <button type="button" className="btn" onClick={() => setEditing(null)}>キャンセル</button>
            <button className="btn btn-primary">保存</button>
          </div>
        </form>
      )}
      <table className="table">
        <thead><tr><th>表示順</th><th>仕訳名</th><th>コード</th><th>状態</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.is_active ? '' : 'row-muted'}>
              <td>{r.sort_order}</td><td>{r.name}</td><td>{r.code}</td><td>{r.is_active ? '有効' : '無効'}</td>
              <td><button className="btn btn-small" onClick={() => { setEditing({ ...r }); setError(''); }}>編集</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
