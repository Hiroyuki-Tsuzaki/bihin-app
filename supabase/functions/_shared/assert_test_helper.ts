// テスト用の assert（外部パッケージに依存しないよう node:assert を利用）
import nodeAssert from 'node:assert/strict';
export const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);
export const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
