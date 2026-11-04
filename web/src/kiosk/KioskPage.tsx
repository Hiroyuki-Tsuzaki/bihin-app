import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Cart, fromLines, increment, normalizeEmployeeNo, toLines } from '../lib/cart';
import {
  type ApiError,
  DEVICE_KEY_ERRORS,
  type KioskItem,
  listItems,
  lookupEmployee,
  newRequestId,
  type ParsedLine,
  parseText,
  type UseResultLine,
  useItems,
} from '../lib/kioskApi';
import { EmployeeNoNotice } from '../lib/Notice';
import { clearDeviceKey, loadDeviceKey } from '../lib/storage';
import { imageUrl } from '../lib/supabase';
import { DeviceKeySetup } from './DeviceKeySetup';

type Step = 'select' | 'aiConfirm' | 'employee' | 'done';

interface AiState {
  text: string;
  lines: ParsedLine[];
  unmatched: string[];
  note?: string;
}

const AUTO_RESET_SEC = 15;

export function KioskPage() {
  const [deviceKey, setDeviceKey] = useState<string | null>(() => loadDeviceKey());
  const [keyReason, setKeyReason] = useState<string>();
  const [items, setItems] = useState<KioskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Cart>({});
  const [step, setStep] = useState<Step>('select');
  const [source, setSource] = useState<'manual' | 'natural_language'>('manual');
  const [aiText, setAiText] = useState('');
  const [ai, setAi] = useState<AiState | null>(null);
  const [employeeNo, setEmployeeNo] = useState('');
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string>(newRequestId());
  const [result, setResult] = useState<{ lines: UseResultLine[]; name: string; at: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_RESET_SEC);
  const employeeInput = useRef<HTMLInputElement>(null);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const lines = toLines(cart);

  const handleApiError = useCallback((e: ApiError) => {
    if (DEVICE_KEY_ERRORS.includes(e.error)) {
      clearDeviceKey();
      setKeyReason(e.message);
      setDeviceKey(null);
      return;
    }
    setError(e);
  }, []);

  const refresh = useCallback(async () => {
    if (!deviceKey) return;
    setLoading(true);
    const r = await listItems(deviceKey);
    setLoading(false);
    if (!r.ok) return handleApiError(r);
    setItems(r.items);
  }, [deviceKey, handleApiError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resetAll = useCallback(() => {
    setCart({});
    setAi(null);
    setAiText('');
    setEmployeeNo('');
    setConfirmName(null);
    setResult(null);
    setError(null);
    setSource('manual');
    setRequestId(newRequestId());
    setStep('select');
    refresh();
  }, [refresh]);

  // 完了画面から自動で最初に戻る
  useEffect(() => {
    if (step !== 'done') return;
    setCountdown(AUTO_RESET_SEC);
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [step]);
  useEffect(() => {
    if (step === 'done' && countdown <= 0) resetAll();
  }, [countdown, step, resetAll]);

  useEffect(() => {
    if (step === 'employee') employeeInput.current?.focus();
  }, [step]);

  if (!deviceKey) {
    return <DeviceKeySetup reason={keyReason} onDone={(k) => { setKeyReason(undefined); setDeviceKey(k); }} />;
  }

  async function runAi() {
    if (!deviceKey || !aiText.trim()) return;
    setBusy(true);
    setError(null);
    const r = await parseText(deviceKey, aiText.trim());
    setBusy(false);
    if (!r.ok) return handleApiError(r);
    setAi({ text: aiText.trim(), lines: r.lines, unmatched: r.unmatched, note: r.note });
    setStep('aiConfirm');
  }

  function acceptAi() {
    if (!ai) return;
    setCart(fromLines(ai.lines));
    setSource('natural_language');
    setRequestId(newRequestId());
    setStep('employee');
  }

  function goEmployee() {
    setSource('manual');
    setRequestId(newRequestId());
    setError(null);
    setStep('employee');
  }

  async function submitEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!deviceKey) return;
    const no = normalizeEmployeeNo(employeeNo);
    if (!no) return;
    setBusy(true);
    setError(null);
    const r = await lookupEmployee(deviceKey, no);
    setBusy(false);
    if (!r.ok) return handleApiError(r);
    setConfirmName(r.employee_name);
  }

  // 「いいえ」→ 備品選択画面へ戻る
  function answerNo() {
    setConfirmName(null);
    setEmployeeNo('');
    setStep('select');
  }

  // 「はい」→ 登録
  async function answerYes() {
    if (!deviceKey) return;
    setBusy(true);
    const r = await useItems(deviceKey, requestId, normalizeEmployeeNo(employeeNo), lines, source, source === 'natural_language' ? ai?.text ?? null : null);
    setBusy(false);
    setConfirmName(null);
    if (!r.ok) {
      handleApiError(r);
      if (r.error === 'insufficient_stock' || r.error === 'unknown_item') {
        setRequestId(newRequestId());
        setStep('select');
        refresh();
      }
      return;
    }
    setResult({ lines: r.lines, name: r.employee_name, at: r.used_at_jst });
    setStep('done');
  }

  const errorBox = error && (
    <div className="alert alert-error" role="alert">
      <div>{error.message}</div>
      {error.shortages && (
        <ul>
          {error.shortages.map((s) => (
            <li key={s.item_id}>{s.item_name}：希望 {s.requested}{s.unit} ／ 在庫 {s.stock}{s.unit}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="kiosk">
      <header className="kiosk-header">
        <h1>備品の受取</h1>
        <div className="steps">
          <span className={step === 'select' || step === 'aiConfirm' ? 'active' : ''}>1. 備品と数量</span>
          <span className={step === 'employee' ? 'active' : ''}>2. 社員番号（受取サイン）</span>
          <span className={step === 'done' ? 'active' : ''}>3. 完了</span>
        </div>
      </header>

      <main className="kiosk-main">
        {errorBox}

        {step === 'select' && (
          <>
            <section className="ai-box">
              <label htmlFor="ai-text"><span className="badge badge-ai">AI</span> 文章で入力することもできます</label>
              <div className="row">
                <input
                  id="ai-text"
                  className="input-lg grow"
                  placeholder="例：単3電池を4本と、A4のコピー用紙を1冊"
                  maxLength={300}
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runAi(); }}
                />
                <button className="btn btn-lg" onClick={runAi} disabled={busy || !aiText.trim()}>
                  {busy ? '読み取り中…' : 'AIで読み取る'}
                </button>
              </div>
            </section>

            {loading ? <p className="muted">読み込み中…</p> : (
              <section className="item-grid">
                {items.map((item) => {
                  const q = cart[item.id] ?? 0;
                  const out = item.stock <= 0;
                  return (
                    <div key={item.id} className={`item-card ${q > 0 ? 'selected' : ''} ${out ? 'disabled' : ''}`}>
                      <button className="item-body" disabled={out} onClick={() => setCart(increment(cart, item.id, q === 0 ? 1 : 0))}>
                        {imageUrl(item.image_path)
                          ? <img src={imageUrl(item.image_path)!} alt="" loading="lazy" />
                          : <div className="noimg">{item.name.slice(0, 2)}</div>}
                        <div className="item-name">{item.name}</div>
                        <div className="item-stock">
                          在庫 {item.stock}{item.unit}
                          {out ? <span className="badge badge-danger">在庫なし</span> : item.low && <span className="badge badge-warn">残りわずか</span>}
                        </div>
                      </button>
                      {q > 0 && (
                        <div className="stepper">
                          <button className="btn" onClick={() => setCart(increment(cart, item.id, -1))} aria-label="減らす">−</button>
                          <span className="qty">{q}<small>{item.unit}</small></span>
                          <button className="btn" onClick={() => setCart(increment(cart, item.id, 1))} disabled={q >= item.stock} aria-label="増やす">＋</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}

        {step === 'aiConfirm' && ai && (
          <section className="panel">
            <h2>AIの読み取り結果を確認してください</h2>
            <p className="muted">入力：「{ai.text}」</p>
            {ai.lines.length === 0 ? <div className="alert alert-warn">登録できる備品を読み取れませんでした。</div> : (
              <table className="table">
                <thead><tr><th>備品</th><th>数量</th><th>在庫</th><th /></tr></thead>
                <tbody>
                  {ai.lines.map((l) => (
                    <tr key={l.item_id} className={l.quantity > l.stock ? 'row-danger' : ''}>
                      <td>{l.item_name}</td>
                      <td>
                        <div className="stepper inline">
                          <button className="btn" onClick={() => setAi({ ...ai, lines: ai.lines.map((x) => x.item_id === l.item_id ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x) })}>−</button>
                          <span className="qty">{l.quantity}<small>{l.unit}</small></span>
                          <button className="btn" onClick={() => setAi({ ...ai, lines: ai.lines.map((x) => x.item_id === l.item_id ? { ...x, quantity: x.quantity + 1 } : x) })}>＋</button>
                        </div>
                      </td>
                      <td>{l.stock}{l.unit}{l.quantity > l.stock && <span className="badge badge-danger">不足</span>}</td>
                      <td><button className="btn btn-link" onClick={() => setAi({ ...ai, lines: ai.lines.filter((x) => x.item_id !== l.item_id) })}>削除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {ai.unmatched.length > 0 && <div className="alert alert-warn">読み取れなかった内容：{ai.unmatched.join('、')}</div>}
            {ai.note && <div className="alert alert-info">{ai.note}</div>}
            <div className="row end">
              <button className="btn btn-lg" onClick={() => setStep('select')}>やり直す</button>
              <button
                className="btn btn-primary btn-lg"
                disabled={ai.lines.length === 0 || ai.lines.some((l) => l.quantity > l.stock)}
                onClick={acceptAi}
              >この内容で次へ</button>
            </div>
          </section>
        )}

        {step === 'employee' && (
          <section className="panel">
            <h2>受取内容</h2>
            <ul className="summary">
              {lines.map((l) => {
                const item = itemById.get(l.item_id);
                return <li key={l.item_id}>{item?.name ?? `#${l.item_id}`}　<strong>{l.quantity}{item?.unit}</strong></li>;
              })}
            </ul>
            <form onSubmit={submitEmployee} className="stack">
              <label htmlFor="empno">受取サインとして、社員番号を入力してください</label>
              <input
                id="empno"
                ref={employeeInput}
                className="input-xl"
                inputMode="numeric"
                autoComplete="off"
                maxLength={20}
                value={employeeNo}
                onChange={(e) => setEmployeeNo(e.target.value)}
              />
              <div className="row end">
                <button type="button" className="btn btn-lg" onClick={() => { setError(null); setStep('select'); }}>戻る</button>
                <button className="btn btn-primary btn-lg" disabled={busy || !employeeNo.trim()}>使う</button>
              </div>
            </form>
            <EmployeeNoNotice />
          </section>
        )}

        {step === 'done' && result && (
          <section className="panel done">
            <h2>✓ 受取を記録しました</h2>
            <p>{result.name} さん（{result.at}）</p>
            <table className="table">
              <thead><tr><th>備品</th><th>数量</th><th>残り在庫</th></tr></thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.item_id}>
                    <td>{l.item_name}</td>
                    <td>{l.quantity}{l.unit}</td>
                    <td>{l.stock_after}{l.unit}{l.below_threshold && <span className="badge badge-warn">補充依頼対象</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">確認メールを送信します。{countdown}秒後に最初の画面に戻ります。</p>
            <button className="btn btn-primary btn-lg" onClick={resetAll}>続けて登録する</button>
          </section>
        )}
      </main>

      {step === 'select' && (
        <footer className="cart-bar">
          <div>
            {lines.length === 0 ? <span className="muted">備品をタップして選んでください</span> : (
              <span>選択中：{lines.map((l) => `${itemById.get(l.item_id)?.name ?? ''} ${l.quantity}${itemById.get(l.item_id)?.unit ?? ''}`).join('、')}</span>
            )}
          </div>
          <div className="row">
            {lines.length > 0 && <button className="btn" onClick={() => setCart({})}>クリア</button>}
            <button className="btn btn-primary btn-lg" disabled={lines.length === 0} onClick={goEmployee}>次へ</button>
          </div>
        </footer>
      )}

      {step === 'select' && (
        <div className="kiosk-foot">
          <EmployeeNoNotice compact />
          <span className="muted small"><a href="#/admin">管理画面</a></span>
        </div>
      )}

      {confirmName && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <p className="modal-q"><strong>{confirmName}</strong> さんが受取として記録しますか？</p>
            <ul className="summary">
              {lines.map((l) => <li key={l.item_id}>{itemById.get(l.item_id)?.name}　{l.quantity}{itemById.get(l.item_id)?.unit}</li>)}
            </ul>
            <div className="row end">
              <button className="btn btn-lg" onClick={answerNo} disabled={busy}>いいえ</button>
              <button className="btn btn-primary btn-lg" onClick={answerYes} disabled={busy}>{busy ? '登録中…' : 'はい'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

