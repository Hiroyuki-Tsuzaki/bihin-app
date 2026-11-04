import { useState } from 'react';
import { supabase } from '../lib/supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(/invalid login credentials/i.test(error.message)
        ? 'メールアドレスまたはパスワードが正しくありません'
        : `ログインに失敗しました：${error.message}（接続先 ${import.meta.env.VITE_SUPABASE_URL}）`);
    }
  }

  return (
    <div className="center-card">
      <h1>備品管理 ― 管理画面</h1>
      <p className="muted">備品担当者のメールアドレスとパスワードでログインしてください。</p>
      <form onSubmit={submit} className="stack">
        <input className="input-lg" type="email" placeholder="メールアドレス" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input-lg" type="password" placeholder="パスワード" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy || !email || !password}>{busy ? 'ログイン中…' : 'ログイン'}</button>
      </form>
      <p className="small"><a href="#/">← 利用画面へ</a></p>
    </div>
  );
}
