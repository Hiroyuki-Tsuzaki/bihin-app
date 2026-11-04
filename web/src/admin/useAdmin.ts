import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type AdminState = { status: 'loading' } | { status: 'signedOut' } | { status: 'notAdmin'; session: Session } | { status: 'admin'; session: Session };

export function useAdmin(): AdminState {
  const [state, setState] = useState<AdminState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    async function evaluate(session: Session | null) {
      if (!session) return alive && setState({ status: 'signedOut' });
      const { data } = await supabase.rpc('is_admin');
      if (alive) setState(data === true ? { status: 'admin', session } : { status: 'notAdmin', session });
    }
    supabase.auth.getSession().then(({ data }) => evaluate(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setTimeout(() => evaluate(session), 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return state;
}

/** Supabase のエラーを日本語メッセージに */
export function errMsg(e: unknown): string {
  if (!e) return '';
  const m = (e as { message?: string }).message ?? String(e);
  if (/duplicate key.*employee_no/.test(m)) return 'その社員番号はすでに登録されています';
  if (/duplicate key.*account_titles_name/.test(m)) return 'その仕訳名はすでに登録されています';
  if (/violates check constraint.*employee_no/.test(m)) return '社員番号は半角英数字・ハイフン・アンダースコア20文字以内で入力してください';
  if (/violates check constraint.*email/.test(m)) return 'メールアドレスの形式が正しくありません';
  if (/violates foreign key/.test(m)) return '他のデータから参照されているため削除できません（無効化してください）';
  return m;
}
