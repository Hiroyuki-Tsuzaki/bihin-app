import { HashRouter, Route, Routes } from 'react-router-dom';
import { AdminApp } from './admin/AdminApp';
import { KioskPage } from './kiosk/KioskPage';
import { configError } from './lib/supabase';

// GitHub Pages でもリロード時に404にならないよう HashRouter を使う（/#/ 利用画面、/#/admin 管理画面）
export function App() {
  if (configError) return <div className="center-card alert alert-error">{configError}</div>;
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<KioskPage />} />
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </HashRouter>
  );
}
