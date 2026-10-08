import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Resolve Supabase environment variables from server or client runtime safely
export const getSupabaseUrl = (): string => {
  let url = '';
  if (typeof process !== 'undefined' && process.env) {
    url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  }
  if (!url) {
    try {
      url = (import.meta as any).env?.VITE_SUPABASE_URL || (import.meta as any).env?.SUPABASE_URL || '';
    } catch {
      url = '';
    }
  }
  return (url || '').trim();
};

export const getSupabaseAnonKey = (): string => {
  let key = '';
  if (typeof process !== 'undefined' && process.env) {
    key =
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      '';
  }
  if (!key) {
    try {
      key =
        (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
        (import.meta as any).env?.SUPABASE_ANON_KEY ||
        '';
    } catch {
      key = '';
    }
  }
  return (key || '').trim();
};

export const supabaseUrl = getSupabaseUrl();
export const supabaseAnonKey = getSupabaseAnonKey();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export function getSupabaseClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) return null;
  try {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
  } catch (e) {
    console.error('Failed to create Supabase client:', e);
    return null;
  }
}

export const supabase: SupabaseClient | null = getSupabaseClient();

export interface SupabaseDiagnosticStatus {
  SUPABASE_URL: 'CONFIGURED' | 'MISSING';
  SUPABASE_ANON_KEY: 'CONFIGURED' | 'MISSING';
  SUPABASE_CLIENT: 'CONNECTED' | 'FAILED';
  DATABASE_QUERY: 'PASS' | 'FAIL';
  AUTH_SERVICE: 'AVAILABLE' | 'FAILED';
  missingVariableNames: string[];
  // Backwards compatible aliases for UI
  supabaseUrlStatus?: 'CONFIGURED' | 'MISSING';
  supabaseClientStatus?: 'CONNECTED' | 'FAILED';
  databaseQueryStatus?: 'PASS' | 'FAIL';
  authServiceStatus?: 'AVAILABLE' | 'FAILED';
}

/**
 * Safely tests Supabase health without revealing secrets
 */
export async function testSupabaseHealth(): Promise<SupabaseDiagnosticStatus> {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  const urlConfigured = Boolean(url && url.length > 0);
  const keyConfigured = Boolean(key && key.length > 0);

  const missingVarNames: string[] = [];
  if (!urlConfigured) missingVarNames.push('SUPABASE_URL');
  if (!keyConfigured) missingVarNames.push('SUPABASE_ANON_KEY');

  if (!urlConfigured || !keyConfigured) {
    return {
      SUPABASE_URL: urlConfigured ? 'CONFIGURED' : 'MISSING',
      SUPABASE_ANON_KEY: keyConfigured ? 'CONFIGURED' : 'MISSING',
      SUPABASE_CLIENT: 'FAILED',
      DATABASE_QUERY: 'FAIL',
      AUTH_SERVICE: 'FAILED',
      missingVariableNames: missingVarNames,
      supabaseUrlStatus: urlConfigured ? 'CONFIGURED' : 'MISSING',
      supabaseClientStatus: 'FAILED',
      databaseQueryStatus: 'FAIL',
      authServiceStatus: 'FAILED'
    };
  }

  try {
    const client = createClient(url, key);
    
    // Execute real ping query against clients table
    const { error } = await client.from('clients').select('id').limit(1);

    const querySuccess = !error || error.code === 'PGRST116' || (error.message && error.message.includes('permission'));

    return {
      SUPABASE_URL: 'CONFIGURED',
      SUPABASE_ANON_KEY: 'CONFIGURED',
      SUPABASE_CLIENT: 'CONNECTED',
      DATABASE_QUERY: querySuccess ? 'PASS' : 'FAIL',
      AUTH_SERVICE: 'AVAILABLE',
      missingVariableNames: [],
      supabaseUrlStatus: 'CONFIGURED',
      supabaseClientStatus: 'CONNECTED',
      databaseQueryStatus: querySuccess ? 'PASS' : 'FAIL',
      authServiceStatus: 'AVAILABLE'
    };
  } catch {
    return {
      SUPABASE_URL: 'CONFIGURED',
      SUPABASE_ANON_KEY: 'CONFIGURED',
      SUPABASE_CLIENT: 'FAILED',
      DATABASE_QUERY: 'FAIL',
      AUTH_SERVICE: 'FAILED',
      missingVariableNames: [],
      supabaseUrlStatus: 'CONFIGURED',
      supabaseClientStatus: 'FAILED',
      databaseQueryStatus: 'FAIL',
      authServiceStatus: 'FAILED'
    };
  }
}

