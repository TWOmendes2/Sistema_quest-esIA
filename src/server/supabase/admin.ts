import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/server/env';

export function createSupabaseAdminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function createSupabaseAnonServerClient() {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function appSchema() {
  return createSupabaseAdminClient().schema('app');
}
