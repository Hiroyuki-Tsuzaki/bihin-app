import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { jstDate } from '../lib/format';
import { EmployeeNoNotice } from '../lib/Notice';
import { supabase } from '../lib/supabase';
import type { Item } from './types';

export function Dashboard() {
  const [low, setLow] = useState<Item[]>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [failedMails, setFailedMails] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: items } = await supabase.from('items').select('*').eq('is_active', true).order('sort_order');
      setLow(((items ?? []) as Item[]).filter((i) => i.stock <= i.threshold));
      const since = `${jstDate()}T00:00:00+09:00`;
      const { count } = await supabase.from('usage_batches').select('*', { count: 'exact', head: true }).gte('used_at', since);
      setTodayCount(count ?? 0);
      const { count: failed } = await supabase.from('mail_outbox').select('*', { count: 'exact', head: true }).eq('status', 'failed');
      setFailedMails(failed ?? 0);
    })();
  }, []);

  return (
    <div className="stack">
      <h1>ダッシュボード</h1>
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">補充依頼の対象</div><div className="kpi-value">{low.length}<small>品目</small></div></div>
        <div className="kpi"><div className="kpi-label">本日の受取</div><div className="kpi-value">{todayCount}<small>件</small></div></div>
        <div className="kpi"><div className="kpi-label">送信失敗メール</div><div className={`kpi-value ${failedMails ? 'danger' : ''}`}>{failedMails}<small>通</small></div></div>
      </div>
      <section className="panel">
        <h2>在庫がしきい値以下の備品</h2>
        {low.length === 0 ? <p className="muted">ありません</p> : (
          <table className="table">
            <thead><tr><th>備品</th><th>現在庫</th><th>しきい値</th><th /></tr></thead>
            <tbody>
              {low.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className={i.stock === 0 ? 'danger' : 'warn'}>{i.stock}{i.unit}</td>
                  <td>{i.threshold}{i.unit}</td>
                  <td><Link to={`/admin/restock?item=${i.id}`}>補充する</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">しきい値以下の備品は、しきい値を上回るまで毎日9:00に備品担当者へ補充依頼メールが送られます。</p>
      </section>
      <section className="panel">
        <h2>運用上の注意</h2>
        <EmployeeNoNotice />
        <ul className="small">
          <li>社員番号を入力すると利用端末に氏名が表示されます。端末キーを知っている人は番号から氏名を確認できるため、端末キーは社外に漏らさず、定期的に変更してください（「端末キー」メニュー）。</li>
          <li>端末キーを変更すると、すべての利用端末で再入力が必要です。</li>
          <li>利用画面は GitHub Pages（インターネット公開）で配信しています。端末キーは簡易的なアクセス制限であり、社内ネットワーク限定ではありません。</li>
          <li>メールは送信待ちに登録後、1分以内に送信されます。送信に失敗しても在庫・履歴はそのままで、自動で再送されます。</li>
        </ul>
      </section>
    </div>
  );
}
