import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
  throw new Error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');
}

const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

/** Legacy client-side fallback. With the new missions flow this route is a no-op,
 * kept only so older clients don't break. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Always report "nothing to move" – all new missions are created directly.
    return res.status(200).json({ moved: false });
  } catch (e: any) {
    console.error('verify-job-payment error:', e?.message);
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
