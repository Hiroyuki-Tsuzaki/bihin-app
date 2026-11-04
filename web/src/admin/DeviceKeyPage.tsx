import { useCallback, useEffect, useState } from 'react';
import { jst, randomKey } from '../lib/format';
import { supabase } from '../lib/supabase';
import { errMsg } from './useAdmin';

interface Status { configured: boolean; version: number; updated_at: string | null; updated_by: string | null; locked_ips: number }

export function DeviceKeyPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_device_key_status');
    setStatus(data as Status);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (key.length < 12) return setError('推測されにくいよう、12文字以上のランダムな文字列にしてください');
    if (!window.confirm('端末キーを変更すると、すべての利用端末で新しいキーの入力が必要になります。変更しますか？')) return;
    const { error } = await supabase.rpc('admin_set_device_key', { p_new_key: key });
    if (error) return setError(errMsg(error));
    setDone(key);
    setKey('');
    load();
  }

  async function unlock() {
    const { error } = await supabase.rpc('admin_clear_lockouts');
    if (error) return setError(errMsg(error));
    load();
  }

  return (
    <div className="stack">
      <h1>端末キー</h1>
      <p>利用画面（備品の受取）を使う端末に一度だけ入力してもらう合言葉です。URLを知っているだけでは利用できないようにする簡易的な制限です。</p>
      {status && (
        <div className="panel">
          <div>状態：{status.configured ? `設定済み（第${status.version}版）` : <strong className="danger">未設定</strong>}</div>
          {status.updated_at && <div className="muted small">最終変更：{jst(status.updated_at)}　{status.updated_by}</div>}
          <div className="small">失敗が続いてロック中の接続元：{status.locked_ips}件 {status.locked_ips > 0 && <button className="btn btn-small" onClick={unlock}>ロックを解除</button>}</div>
        </div>
      )}
      <form className="panel stack" onSubmit={change}>
        <h2>端末キーを変更</h2>
        <div className="row">
          <input className="grow mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="新しい端末キー（12文字以上）" autoComplete="off" />
          <button type="button" className="btn" onClick={() => setKey(randomKey())}>ランダム生成</button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div><button className="btn btn-primary" disabled={!key}>変更する</button></div>
      </form>
      {done && (
        <div className="alert alert-success">
          新しい端末キーを設定しました：<code className="mono big">{done}</code><br />
          この画面を閉じると再表示できません。利用端末の担当者に安全な方法で伝えてください。
        </div>
      )}
      <ul className="small muted">
        <li>総当たり対策として、同じ接続元から15分間に10回間違えると15分間ロックされます。</li>
        <li>定期的（例：月1回）に変更し、退職者・異動者が出たときも変更してください。</li>
      </ul>
    </div>
  );
}
