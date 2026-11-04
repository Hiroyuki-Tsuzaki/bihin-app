// 利用端末向け API（すべて端末キー付き）
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { CartLine } from './cart';
import { supabase } from './supabase';

export interface KioskItem {
  id: number;
  name: string;
  unit: string;
  image_path: string | null;
  stock: number;
  low: boolean;
  category_id: number | null;
  category_name: string | null;
}

export interface KioskCategory {
  id: number;
  name: string;
}

export interface Shortage {
  item_id: number;
  item_name: string;
  unit: string;
  requested: number;
  stock: number;
}

export interface UseResultLine {
  item_id: number;
  item_name: string;
  unit: string;
  quantity: number;
  stock_after: number;
  below_threshold: boolean;
}

export interface ApiError {
  ok: false;
  error: string;
  message: string;
  shortages?: Shortage[];
}

export type ApiResult<T> = ({ ok: true } & T) | ApiError;

export const DEVICE_KEY_ERRORS = ['invalid_device_key', 'device_key_not_configured'];

const networkError: ApiError = { ok: false, error: 'network', message: '通信エラーが発生しました。ネットワークを確認して、もう一度お試しください。' };

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<ApiResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(fn, error);
    return networkError;
  }
  return data as ApiResult<T>;
}

export const verifyDeviceKey = (key: string) => rpc<object>('kiosk_verify_device_key', { p_device_key: key });

export const listItems = (key: string) =>
  rpc<{ items: KioskItem[]; categories?: KioskCategory[] }>('kiosk_list_items', { p_device_key: key });

export const lookupEmployee = (key: string, employeeNo: string) =>
  rpc<{ employee_name: string }>('kiosk_lookup_employee', { p_device_key: key, p_employee_no: employeeNo });

export const useItems = (
  key: string,
  requestId: string,
  employeeNo: string,
  lines: CartLine[],
  source: 'manual' | 'natural_language',
  rawText: string | null,
) =>
  rpc<{ lines: UseResultLine[]; employee_name: string; used_at_jst: string; duplicate?: boolean }>('kiosk_use_items', {
    p_device_key: key,
    p_request_id: requestId,
    p_employee_no: employeeNo,
    p_lines: lines,
    p_source: source,
    p_raw_text: rawText,
  });

export interface ParsedLine {
  item_id: number;
  item_name: string;
  unit: string;
  quantity: number;
  stock: number;
  insufficient: boolean;
}

export async function parseText(key: string, text: string): Promise<ApiResult<{ lines: ParsedLine[]; unmatched: string[]; note?: string }>> {
  const { data, error } = await supabase.functions.invoke('parse-usage', { body: { device_key: key, text } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        return await error.context.json();
      } catch {
        /* fallthrough */
      }
    }
    console.error('parse-usage', error);
    return { ok: false, error: 'parse_failed', message: 'AIによる読み取りに失敗しました。一覧から選んでください。' };
  }
  return data;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
