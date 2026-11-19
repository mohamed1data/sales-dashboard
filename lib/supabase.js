import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-placeholder'
);
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'لوحة المبيعات';
export const TZ = process.env.NEXT_PUBLIC_TIMEZONE || 'Africa/Cairo';
export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY || 'EGP';

// true only if the Vercel env vars were present when the app was BUILT (NEXT_PUBLIC_* are baked in at build time)
export const CONFIGURED = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
