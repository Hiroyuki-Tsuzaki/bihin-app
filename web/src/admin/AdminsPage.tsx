import { useCallback, useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { jst } from '../lib/format';
import { supabase } from '../lib/supabase';

interface Admin { user_id: string; email: string; created_at: string }

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try { return await error.context.json(); } catch { /* noop */ }
    }
    return { ok: false, message: error.message };
  }
  return data;
}

export function AdminsPage({ myId }: { myId: string }) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('app_admins').select('*').order('created_at');
    setAdmins((data ?? []) as Admin[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setMsg('');
    const r = await call({ action: 'create', email, password });
    if (!r.ok) return setError(r.message ?? '追加に失敗しました');
    setMsg(`${r.email} を管理者に追加しました。初期パスワードを本人に伝え、ログイン後に変更してもらってください。`);
    setEmail(''); setPassword('');
    load();
  }

  async function remove(a: Admin) {
    if (!window.confirm(`${a.email} を管理者から削除しますか？`)) return;
    setError(''); setMsg('');
    const r = await call({ action: 'delete', user_id: a.user_id });
    if (!r.ok) return setError(r.message ?? '削除に失敗しました');
    load();
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setMsg('');
    if (newPw.length < 10) return setError('パスワードは10文字以上にしてください');
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) return setError(error.message);
    setNewPw('');
    setMsg('パスワードを変更しました');
  }

  return (
    <div className="stack">
      <h1>管理者（備品担当者）</h1>
      <p className="muted">ここに登録された全員が、利用通知・補充依頼メールの宛先になります。</p>
      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <table className="table">
        <thead><tr><th>メールアドレス</th><th>登録日</th><th /></tr></thead>
        <tbody>
          {admins.map((a) => (
            <tr key={a.user_id}><td>{a.email}{a.user_id === myId && <span className="badge">自分</span>}</td><td>{jst(a.created_at)}</td>
              <td>{a.user_id !== myId && <button className="btn btn-small btn-danger" onClick={() => remove(a)}>削除</button>}</td></tr>
          ))}
        </tbody>
      </table>
      <form className="panel form-grid" onSubmit={add}>
        <h2 className="span2">管理者を追加</h2>
        <label>メールアドレス（ログインID）<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>初期パスワード（10文字以上）<input type="text" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></label>
        <div className="row end span2"><button className="btn btn-primary">追加</button></div>
      </form>
      <form className="panel form-grid" onSubmit={changePw}>
        <h2 className="span2">自分のパスワードを変更</h2>
        <label>新しいパスワード<input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" /></label>
        <div className="row end span2"><button className="btn">変更</button></div>
      </form>
    </div>
  );
}
