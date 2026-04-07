import { createClient } from '@supabase/supabase-js';

// Эти ключи должны быть в твоем файле .env или возьми их из дашборда Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase URL or Anon Key is missing! Check your .env file.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
