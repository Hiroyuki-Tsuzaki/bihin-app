import { useState } from 'react';
import { verifyDeviceKey } from '../lib/kioskApi';
import { saveDeviceKey } from '../lib/storage';

export function DeviceKeySetup({ reason, onDone }: { reason?: string; onDone: (key: string) => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState(reason ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    const r = await verifyDeviceKey(key.trim());
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    saveDeviceKey(key.trim());
    onDone(key.trim());
  }

  return (
    <div className="center-card">
      <h1>この端末を登録</h1>
      <p>備品担当者から伝えられた「端末キー」を入力してください。入力はこの端末で一度だけ必要です（キーが変更されたときは再入力が必要です）。</p>
      <form onSubmit={submit} className="stack">
        <input
          className="input-lg"
          type="password"
          autoComplete="off"
          placeholder="端末キー"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label="端末キー"
        />
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy || !key.trim()}>
          {busy ? '確認中…' : '登録する'}
        </button>
      </form>
      <p className="muted small"><a href="#/admin">管理画面（備品担当者）</a></p>
    </div>
  );
}
