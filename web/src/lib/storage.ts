// ブラウザ保存（端末キー）。プライベートモード等で使えない場合も落ちないようにする
const KEY = 'bihin.deviceKey';

export function loadDeviceKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveDeviceKey(value: string) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* 保存できない環境ではページを開いている間だけ有効 */
  }
}

export function clearDeviceKey() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
