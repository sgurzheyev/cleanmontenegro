/**
 * Browser Supabase client (single instance).
 *
 * IMPORTANT: `createClient` must be called in exactly one place for the browser
 * to avoid duplicate initialization and subtle ordering bugs.
 */
export { supabase } from '../services/supabase';
