import { Fragment, useCallback, useEffect, useState } from 'react';
import { jst } from '../lib/format';
import { supabase } from '../lib/supabase';
import { errMsg } from './useAdmin';

interface Mail { id: number; kind: string; to_address: string; subject: string; body: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null; next_attempt_at: string }
interface Reminder { item_id: number; reminder_date: string; stock_at: number; threshold_at: number; items?: { name: string; unit: string } }

const KIND: Record<string, string> = { usage_employee: '受取確認（本人）', usage_admin: '利用通知（担当者）', restock_reminder: '補充依頼' };
const STATUS: Record<string, string> = { pending: '送信待ち', sending: '送信中', sent: '送信済み', failed: '失敗' };

export function MailPage() {
  const [mails, setMails] = useState<Mail[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [{ data: m }, { data: r }] = await Promise.all([
      supabase.from('mail_outbox').select('*').order('id', { ascending: false }).limit(100),
      supabase.from('reminder_log').select('*, items(name, unit)').order('reminder_date', { ascending: false }).limit(50),
    ]);
    setMails((m ?? []) as Mail[]);
    setReminders((r ?? []) as Reminder[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runNow() {
    setError('');
    const { data, error } = await supabase.rpc('admin_run_daily_reminders');
    if (error) return setError(errMsg(error));
    setMsg(data.notified_items > 0 ? `${data.notified_items}品目の補充依頼メールを登録しました（1分以内に送信）` : '本日分はすでに通知済み、または対象の備品がありません');
    load();
  }

  async function retry(id: number) {
    const { error } = await supabase.rpc('admin_retry_mail', { p_id: id });
    if (error) return setError(errMsg(error));
    load();
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>メール・通知</h1>
        <div className="row">
          <button className="btn" onClick={load}>更新</button>
          <button className="btn btn-primary" onClick={runNow}>本日の補充依頼を今すぐ実行</button>
        </div>
      </div>
      <p className="muted small">補充依頼は毎日9:00（日本時間）に自動実行されます。同じ備品への通知は1日1回までです（手動実行しても重複しません）。</p>
      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <section className="panel">
        <h2>送信状況（最新100件）</h2>
        <table className="table">
          <thead><tr><th>登録日時</th><th>種類</th><th>宛先</th><th>件名</th><th>状態</th><th /></tr></thead>
          <tbody>
            {mails.map((m) => (
              <Fragment key={m.id}>
                <tr>
                  <td>{jst(m.created_at)}</td><td className="small">{KIND[m.kind]}</td><td className="small">{m.to_address}</td>
                  <td><button className="btn btn-link" onClick={() => setOpen(open === m.id ? null : m.id)}>{m.subject}</button></td>
                  <td><span className={`badge status-${m.status}`}>{STATUS[m.status]}</span>{m.attempts > 1 && <span className="small muted"> {m.attempts}回目</span>}</td>
                  <td>{m.status === 'failed' && <button className="btn btn-small" onClick={() => retry(m.id)}>再送</button>}</td>
                </tr>
                {open === m.id && (
                  <tr><td colSpan={6}>
                    <pre className="mail-body">{m.body}</pre>
                    {m.last_error && <div className="alert alert-error small">最後のエラー：{m.last_error}</div>}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>補充依頼の送信記録</h2>
        <table className="table">
          <thead><tr><th>日付</th><th>備品</th><th>在庫</th><th>しきい値</th></tr></thead>
          <tbody>
            {reminders.map((r) => (
              <tr key={`${r.item_id}-${r.reminder_date}`}><td>{r.reminder_date}</td><td>{r.items?.name}</td><td>{r.stock_at}{r.items?.unit}</td><td>{r.threshold_at}{r.items?.unit}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
