import { NavLink, Route, Routes } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AccountTitlesPage } from './AccountTitlesPage';
import { AdminsPage } from './AdminsPage';
import { CategoriesPage } from './CategoriesPage';
import { Dashboard } from './Dashboard';
import { DeviceKeyPage } from './DeviceKeyPage';
import { EmployeesPage } from './EmployeesPage';
import { ItemsPage } from './ItemsPage';
import { Login } from './Login';
import { MailPage } from './MailPage';
import { ReportPage } from './ReportPage';
import { RestockPage } from './RestockPage';
import { UsagePage } from './UsagePage';
import { useAdmin } from './useAdmin';

const NAV: Array<[string, string]> = [
  ['', 'ダッシュボード'],
  ['restock', '補充'],
  ['usage', '利用状況'],
  ['items', '備品マスタ'],
  ['categories', 'カテゴリマスタ'],
  ['employees', '社員マスタ'],
  ['account-titles', '仕訳マスタ'],
  ['report', '月次レポート'],
  ['mail', 'メール・通知'],
  ['device-key', '端末キー'],
  ['admins', '管理者'],
];

export function AdminApp() {
  const state = useAdmin();
  if (state.status === 'loading') return <p className="center-card muted">読み込み中…</p>;
  if (state.status === 'signedOut') return <Login />;
  if (state.status === 'notAdmin') {
    return (
      <div className="center-card">
        <h1>アクセスできません</h1>
        <p>{state.session.user.email} は管理者として登録されていません。</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>ログアウト</button>
      </div>
    );
  }
  return (
    <div className="admin">
      <aside className="admin-nav">
        <div className="brand">備品管理</div>
        <nav>
          {NAV.map(([path, label]) => (
            <NavLink key={path} to={`/admin/${path}`} end={path === ''}>{label}</NavLink>
          ))}
        </nav>
        <div className="admin-user">
          <div className="small muted">{state.session.user.email}</div>
          <button className="btn btn-small" onClick={() => supabase.auth.signOut()}>ログアウト</button>
          <a className="small" href="#/">利用画面へ</a>
        </div>
      </aside>
      <main className="admin-main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="restock" element={<RestockPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="account-titles" element={<AccountTitlesPage />} />
          <Route path="report" element={<ReportPage />} />
          <Route path="mail" element={<MailPage />} />
          <Route path="device-key" element={<DeviceKeyPage />} />
          <Route path="admins" element={<AdminsPage myId={state.session.user.id} />} />
        </Routes>
      </main>
    </div>
  );
}
