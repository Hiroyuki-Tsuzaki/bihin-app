import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configError = !url || !key ? 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が設定されていません' : null;

export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, storageKey: 'bihin-admin-auth' },
});

export const IMAGE_BUCKET = 'item-images';

export function imageUrl(path?: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
