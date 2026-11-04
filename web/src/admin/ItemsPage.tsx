import { useCallback, useEffect, useState } from 'react';
import { IMAGE_BUCKET, imageUrl, supabase } from '../lib/supabase';
import { yen } from '../lib/format';
import type { AccountTitle, Item, ItemCategory } from './types';
import { errMsg } from './useAdmin';

const EMPTY: Omit<Item, 'id'> = { name: '', unit: '個', image_path: null, stock: 0, threshold: 0, unit_price: 0, account_title_id: null, category_id: null, sort_order: 0, is_active: true };

export function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [titles, setTitles] = useState<AccountTitle[]>([]);
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [editing, setEditing] = useState<(Omit<Item, 'id'> & { id?: number }) | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: i }, { data: t }, { data: c }] = await Promise.all([
      supabase.from('items').select('*').order('is_active', { ascending: false }).order('sort_order').order('name'),
      supabase.from('account_titles').select('*').order('sort_order'),
      supabase.from('item_categories').select('*').order('sort_order').order('name'),
    ]);
    setItems((i ?? []) as Item[]);
    setTitles((t ?? []) as AccountTitle[]);
    setCategories((c ?? []) as ItemCategory[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const titleName = (id: number | null) => titles.find((t) => t.id === id)?.name ?? '（未設定）';
  const categoryName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? '（未設定）';
  const shown = items.filter((i) => filter === '' || (filter === 'none' ? i.category_id == null : i.category_id === Number(filter)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError('');
    for (const [k, label] of [['stock', '現在庫数'], ['threshold', '通知しきい値'], ['sort_order', '表示順']] as const) {
      if (!Number.isInteger(Number(editing[k])) || Number(editing[k]) < 0) return setError(`${label}は0以上の整数で入力してください`);
    }
    if (!(Number(editing.unit_price) >= 0)) return setError('税抜価格は0以上で入力してください');
    if (!editing.account_title_id) return setError('仕訳項目を選択してください');
    setBusy(true);
    try {
      const { id, ...fields } = editing;
      const row = { ...fields, stock: Number(fields.stock), threshold: Number(fields.threshold), unit_price: Number(fields.unit_price), sort_order: Number(fields.sort_order) };
      let itemId = id;
      if (id) {
        const { error } = await supabase.from('items').update(row).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('items').insert(row).select('id').single();
        if (error) throw error;
        itemId = data.id;
      }
      if (file && itemId) {
        if (file.size > 2 * 1024 * 1024) throw new Error('画像は2MB以下にしてください');
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${itemId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const old = editing.image_path;
        const { error } = await supabase.from('items').update({ image_path: path }).eq('id', itemId);
        if (error) throw error;
        if (old) await supabase.storage.from(IMAGE_BUCKET).remove([old]);
      }
      setMsg(`「${row.name}」を保存しました`);
      setEditing(null);
      setFile(null);
      load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <h1>備品マスタ</h1>
        <button className="btn btn-primary" onClick={() => { setEditing({ ...EMPTY, account_title_id: titles[0]?.id ?? null }); setFile(null); setError(''); setMsg(''); }}>＋ 備品を追加</button>
      </div>
      {msg && <div className="alert alert-success">{msg}</div>}

      {editing && (
        <form className="panel form-grid" onSubmit={save}>
          <h2 className="span2">{editing.id ? '備品の編集' : '備品の追加'}</h2>
          <label>商品名<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label>単位<input required value={editing.unit} placeholder="本・箱・冊など" onChange={(e) => setEditing({ ...editing, unit: e.target.value })} /></label>
          <label>現在庫数<input type="number" min={0} step={1} value={editing.stock} onChange={(e) => setEditing({ ...editing, stock: e.target.value as unknown as number })} /></label>
          <label>通知しきい値（この数以下で補充依頼）<input type="number" min={0} step={1} value={editing.threshold} onChange={(e) => setEditing({ ...editing, threshold: e.target.value as unknown as number })} /></label>
          <label>税抜価格（1{editing.unit || '個'}あたり・円）<input type="number" min={0} step="0.01" value={editing.unit_price} onChange={(e) => setEditing({ ...editing, unit_price: e.target.value as unknown as number })} /></label>
          <label>仕訳項目
            <select value={editing.account_title_id ?? ''} onChange={(e) => setEditing({ ...editing, account_title_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">選択してください</option>
              {titles.filter((t) => t.is_active || t.id === editing.account_title_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>カテゴリ（利用画面のタブ。未設定は「すべて」にだけ表示）
            <select value={editing.category_id ?? ''} onChange={(e) => setEditing({ ...editing, category_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">（未設定）</option>
              {categories.filter((c) => c.is_active || c.id === editing.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : '（無効）'}</option>)}
            </select>
          </label>
          <label>表示順<input type="number" min={0} step={1} value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: e.target.value as unknown as number })} /></label>
          <label className="check"><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> 利用画面に表示する（有効）</label>
          <label className="span2">画像（1枚・2MBまで・PNG/JPEG/WebP/GIF）
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {editing.image_path && !file && <img className="thumb-lg" src={imageUrl(editing.image_path)!} alt="" />}
          {error && <div className="alert alert-error span2">{error}</div>}
          <div className="row end span2">
            <button type="button" className="btn" onClick={() => setEditing(null)}>キャンセル</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
          </div>
        </form>
      )}

      <label className="inline small">カテゴリで絞り込み
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">すべて</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">（未設定）</option>
        </select>
      </label>
      <table className="table">
        <thead><tr><th /><th>商品名</th><th>カテゴリ</th><th>現在庫</th><th>しきい値</th><th>税抜価格</th><th>仕訳</th><th>状態</th><th /></tr></thead>
        <tbody>
          {shown.map((i) => (
            <tr key={i.id} className={i.is_active ? '' : 'row-muted'}>
              <td>{i.image_path ? <img className="thumb" src={imageUrl(i.image_path)!} alt="" /> : <div className="thumb noimg-s" />}</td>
              <td>{i.name}</td>
              <td className={i.category_id == null ? 'muted' : ''}>{categoryName(i.category_id)}</td>
              <td className={i.is_active && i.stock <= i.threshold ? 'warn' : ''}>{i.stock}{i.unit}</td>
              <td>{i.threshold}{i.unit}</td>
              <td>{yen(i.unit_price)}</td>
              <td>{titleName(i.account_title_id)}</td>
              <td>{i.is_active ? '有効' : '無効'}</td>
              <td><button className="btn btn-small" onClick={() => { setEditing({ ...i }); setFile(null); setError(''); setMsg(''); }}>編集</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">過去の履歴を残すため、備品は削除せず「無効」にしてください。</p>
    </div>
  );
}
