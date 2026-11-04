import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Employee } from './types';
import { errMsg } from './useAdmin';

const EMPTY: Omit<Employee, 'id'> = { employee_no: '', name: '', email: '', is_active: true };

export function EmployeesPage() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<(Omit<Employee, 'id'> & { id?: number }) | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('employees').select('*').order('employee_no');
    setRows((data ?? []) as Employee[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError('');
    const { id, ...f } = editing;
    const row = { employee_no: f.employee_no.trim(), name: f.name.trim(), email: f.email?.trim() || null, is_active: f.is_active };
    const { error } = id
      ? await supabase.from('employees').update(row).eq('id', id)
      : await supabase.from('employees').insert(row);
    if (error) return setError(errMsg(error));
    setMsg(`${row.name}（${row.employee_no}）を保存しました`);
    setEditing(null);
    load();
  }

  const shown = rows.filter((r) => !q || r.employee_no.includes(q) || r.name.includes(q) || (r.email ?? '').includes(q));

  return (
    <div className="stack">
      <div className="row between">
        <h1>社員マスタ</h1>
        <button className="btn btn-primary" onClick={() => { setEditing({ ...EMPTY }); setError(''); setMsg(''); }}>＋ 社員を追加</button>
      </div>
      {msg && <div className="alert alert-success">{msg}</div>}
      {editing && (
        <form className="panel form-grid" onSubmit={save}>
          <h2 className="span2">{editing.id ? '社員の編集' : '社員の追加'}</h2>
          <label>社員番号<input required value={editing.employee_no} onChange={(e) => setEditing({ ...editing, employee_no: e.target.value })} /></label>
          <label>氏名<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label className="span2">メールアドレス（受取確認メールの送信先）<input type="email" value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> 有効（退職者などは無効にする）</label>
          {error && <div className="alert alert-error span2">{error}</div>}
          <div className="row end span2">
            <button type="button" className="btn" onClick={() => setEditing(null)}>キャンセル</button>
            <button className="btn btn-primary">保存</button>
          </div>
        </form>
      )}
      <input placeholder="社員番号・氏名・メールで絞り込み" value={q} onChange={(e) => setQ(e.target.value)} />
      <table className="table">
        <thead><tr><th>社員番号</th><th>氏名</th><th>メールアドレス</th><th>状態</th><th /></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className={r.is_active ? '' : 'row-muted'}>
              <td>{r.employee_no}</td><td>{r.name}</td><td>{r.email ?? <span className="muted">未登録</span>}</td><td>{r.is_active ? '有効' : '無効'}</td>
              <td><button className="btn btn-small" onClick={() => { setEditing({ ...r }); setError(''); setMsg(''); }}>編集</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
