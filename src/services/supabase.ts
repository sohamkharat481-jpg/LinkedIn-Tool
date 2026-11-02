import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Resolve Supabase environment variables from server or client runtime safely
export const getSupabaseUrl = (): string => {
  let url = '';
  

  // Try Vite-specific environment access first (replaced at build time for client)
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      const val = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL;
      if (val) {
          console.log('[Supabase Debug] Found URL in import.meta.env:', val);
          url = val;
      }
    }
  } catch (e) {
    // ignore
  }

  // Fallback to process.env (for server-side and dev)
  if (!url && typeof process !== 'undefined' && process.env) {
    const val = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    if (val) {
        console.log('[Supabase Debug] Found URL in process.env:', val);
        url = val;
    }
  }

  // Last resort: check window properties (for runtime injection if any)
  if (!url && typeof window !== 'undefined') {
    const val = (window as any).__SUPABASE_URL__ || (window as any)?.__ENV__?.VITE_SUPABASE_URL;
    if (val) {
        console.log('[Supabase Debug] Found URL in window:', val);
        url = val;
    }
  }

  console.log('[Supabase Debug] Final resolved URL:', url);
  return (url || '').trim();
};

export const getSupabaseAnonKey = (): string => {
  let key = '';

  // Try Vite-specific environment access first
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;
    }
  } catch (e) {
    // ignore
  }

  // Fallback to process.env
  if (!key && typeof process !== 'undefined' && process.env) {
    key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  }

  // Last resort: check window properties
  if (!key && typeof window !== 'undefined') {
    key = (window as any).__SUPABASE_ANON_KEY || (window as any)?.__ENV__?.VITE_SUPABASE_ANON_KEY || '';
  }

  return (key || '').trim();
};

export const getSupabaseServiceRoleKey = (): string => {
  if (typeof process !== 'undefined' && process.env) {
    const raw =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SERVICE_ROLE_KEY ||
      '';
    return (raw || '').trim().replace(/^["']|["']$/g, '');
  }
  return '';
};

export function detectKeyType(key: string): {
  type: 'SERVICE_ROLE' | 'ANON' | 'PUBLISHABLE' | 'UNKNOWN' | 'NONE';
  length: number;
  roleClaim?: string;
  isServiceRole: boolean;
} {
  if (!key) return { type: 'NONE', length: 0, isServiceRole: false };
  const trimmed = key.trim().replace(/^["']|["']$/g, '');
  if (trimmed.startsWith('sb_publishable_')) {
    return { type: 'PUBLISHABLE', length: trimmed.length, roleClaim: 'publishable', isServiceRole: false };
  }
  if (trimmed.startsWith('sb_secret_')) {
    return { type: 'SERVICE_ROLE', length: trimmed.length, roleClaim: 'service_role', isServiceRole: true };
  }
  const parts = trimmed.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const role = payload.role || payload.iss || 'unknown';
      const isService = role === 'service_role';
      return {
        type: isService ? 'SERVICE_ROLE' : 'ANON',
        length: trimmed.length,
        roleClaim: role,
        isServiceRole: isService
      };
    } catch {
      // ignore
    }
  }
  return { type: 'UNKNOWN', length: trimmed.length, isServiceRole: false };
}

export function isPlaceholderUrl(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase().trim();
  return (
    lower.includes('your-project') ||
    lower.includes('example.com') ||
    lower.includes('placeholder') ||
    !lower.startsWith('http')
  );
}

export function isPlaceholderKey(key: string): boolean {
  if (!key) return true;
  const lower = key.toLowerCase().trim();
  return (
    lower.startsWith('your-') ||
    lower.includes('placeholder') ||
    key.length < 30
  );
}

export const supabaseUrl = getSupabaseUrl();
export const supabaseAnonKey = getSupabaseAnonKey();

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  !isPlaceholderUrl(supabaseUrl) &&
  supabaseAnonKey &&
  !isPlaceholderKey(supabaseAnonKey)
);

export function getSupabaseServerClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  if (!url || isPlaceholderUrl(url)) return null;

  const serviceKey = getSupabaseServiceRoleKey();
  if (!serviceKey || isPlaceholderKey(serviceKey)) {
    // Explicitly fail if service role credential is not provided; never fallback to anon key for server writes
    return null;
  }

  const keyInfo = detectKeyType(serviceKey);
  if (keyInfo.type === 'PUBLISHABLE' || keyInfo.roleClaim === 'anon') {
    console.warn(`[Supabase Server Client Error] Configured SUPABASE_SERVICE_ROLE_KEY is an ANON/PUBLISHABLE key (type: ${keyInfo.type}, role: ${keyInfo.roleClaim}). Refusing unprivileged server client creation.`);
    return null;
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      }
    }
  });
}

let cachedClient: SupabaseClient | null = null;
let cachedKeyUsed: string = '';

export function getSupabaseClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  if (!url || isPlaceholderUrl(url)) return null;
  const isServer = typeof window === 'undefined' && typeof process !== 'undefined';
  if (isServer) {
    return getSupabaseServerClient();
  }

  const key = getSupabaseAnonKey();
  if (!key || isPlaceholderKey(key)) return null;

  if (cachedClient && cachedKeyUsed === key) {
    return cachedClient;
  }

  try {
    const client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
    cachedClient = client;
    cachedKeyUsed = key;
    return client;
  } catch (e) {
    console.error('[Supabase Error] Failed to create Supabase client:', e);
    return null;
  }
}

// Cached client accessor
export const supabase: SupabaseClient | null = getSupabaseClient();

if (!supabase) {
  console.error('[Supabase Error] supabase client is null at initialization.', {
      url: getSupabaseUrl(),
      hasKey: !!getSupabaseAnonKey(),
  });
}


export interface SupabaseDiagnosticStatus {
  SUPABASE_URL: 'CONFIGURED' | 'MISSING' | 'PLACEHOLDER' | 'MALFORMED';
  SUPABASE_ANON_KEY: 'CONFIGURED' | 'MISSING' | 'PLACEHOLDER';
  SUPABASE_CLIENT: 'CONNECTED' | 'FAILED';
  DATABASE_QUERY: 'PASS' | 'FAIL' | 'SKIPPED';
  AUTH_SERVICE: 'AVAILABLE' | 'FAILED';
  missingVariableNames: string[];
  failureCategory?:
    | 'MISSING_CONFIGURATION'
    | 'PLACEHOLDER_CONFIGURATION'
    | 'MALFORMED_URL'
    | 'DNS_RESOLUTION_FAILURE'
    | 'CONNECTION_TIMEOUT'
    | 'CONNECTION_REFUSED'
    | 'TLS_NETWORK_FAILURE'
    | 'HTTP_ERROR'
    | 'RLS_PERMISSION_DENIED'
    | 'TABLE_NOT_FOUND'
    | 'DATABASE_QUERY_ERROR'
    | 'NONE';
  diagnosticsDetail?: string;
  hasServiceRoleKey?: boolean;
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
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const hasServiceRoleKey = Boolean(serviceRoleKey && serviceRoleKey.length > 20);

  const missingVarNames: string[] = [];
  if (!url) missingVarNames.push('SUPABASE_URL');
  if (!key) missingVarNames.push('SUPABASE_ANON_KEY');

  if (!url || !key) {
    return {
      SUPABASE_URL: url ? 'CONFIGURED' : 'MISSING',
      SUPABASE_ANON_KEY: key ? 'CONFIGURED' : 'MISSING',
      SUPABASE_CLIENT: 'FAILED',
      DATABASE_QUERY: 'FAIL',
      AUTH_SERVICE: 'FAILED',
      missingVariableNames: missingVarNames,
      failureCategory: 'MISSING_CONFIGURATION',
      diagnosticsDetail: `Missing required environment variables: ${missingVarNames.join(', ')}`,
      hasServiceRoleKey,
      supabaseUrlStatus: url ? 'CONFIGURED' : 'MISSING',
      supabaseClientStatus: 'FAILED',
      databaseQueryStatus: 'FAIL',
      authServiceStatus: 'FAILED'
    };
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!parsedUrl.protocol.startsWith('http')) {
      throw new Error('Invalid protocol');
    }
  } catch {
    return {
      SUPABASE_URL: 'MALFORMED',
      SUPABASE_ANON_KEY: isPlaceholderKey(key) ? 'PLACEHOLDER' : 'CONFIGURED',
      SUPABASE_CLIENT: 'FAILED',
      DATABASE_QUERY: 'FAIL',
      AUTH_SERVICE: 'FAILED',
      missingVariableNames: [],
      failureCategory: 'MALFORMED_URL',
      diagnosticsDetail: 'SUPABASE_URL is not a valid HTTP/HTTPS URL.',
      hasServiceRoleKey,
      supabaseUrlStatus: 'CONFIGURED',
      supabaseClientStatus: 'FAILED',
      databaseQueryStatus: 'FAIL',
      authServiceStatus: 'FAILED'
    };
  }

  // Check for placeholder values
  if (isPlaceholderUrl(url) || isPlaceholderKey(key)) {
    return {
      SUPABASE_URL: isPlaceholderUrl(url) ? 'PLACEHOLDER' : 'CONFIGURED',
      SUPABASE_ANON_KEY: isPlaceholderKey(key) ? 'PLACEHOLDER' : 'CONFIGURED',
      SUPABASE_CLIENT: 'FAILED',
      DATABASE_QUERY: 'SKIPPED',
      AUTH_SERVICE: 'FAILED',
      missingVariableNames: [],
      failureCategory: 'PLACEHOLDER_CONFIGURATION',
      diagnosticsDetail: 'Supabase credentials contain default placeholder values (e.g., your-project.supabase.co). Please configure production project credentials.',
      hasServiceRoleKey,
      supabaseUrlStatus: 'CONFIGURED',
      supabaseClientStatus: 'FAILED',
      databaseQueryStatus: 'FAIL',
      authServiceStatus: 'FAILED'
    };
  }

  // Minimal server-side network probe without exposing credentials
  try {
    const probeRes = await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!probeRes.ok && probeRes.status !== 401 && probeRes.status !== 404) {
      return {
        SUPABASE_URL: 'CONFIGURED',
        SUPABASE_ANON_KEY: 'CONFIGURED',
        SUPABASE_CLIENT: 'FAILED',
        DATABASE_QUERY: 'FAIL',
        AUTH_SERVICE: 'FAILED',
        missingVariableNames: [],
        failureCategory: 'HTTP_ERROR',
        diagnosticsDetail: `Supabase REST endpoint returned HTTP status ${probeRes.status}.`,
        hasServiceRoleKey,
        supabaseUrlStatus: 'CONFIGURED',
        supabaseClientStatus: 'FAILED',
        databaseQueryStatus: 'FAIL',
        authServiceStatus: 'FAILED'
      };
    }
  } catch (probeErr: any) {
    const errMsg = String(probeErr?.message || probeErr || '');
    const errCode = String(probeErr?.code || probeErr?.cause?.code || '');

    let failureCategory: SupabaseDiagnosticStatus['failureCategory'] = 'HTTP_ERROR';
    let diagnosticsDetail = 'Network probe to Supabase endpoint failed.';

    if (errCode === 'ENOTFOUND' || errMsg.includes('ENOTFOUND')) {
      failureCategory = 'DNS_RESOLUTION_FAILURE';
      diagnosticsDetail = 'DNS resolution failed. The configured Supabase hostname could not be resolved.';
    } else if (errCode === 'ECONNREFUSED' || errMsg.includes('ECONNREFUSED')) {
      failureCategory = 'CONNECTION_REFUSED';
      diagnosticsDetail = 'Connection refused by the host server.';
    } else if (errCode === 'ETIMEDOUT' || errMsg.includes('timeout') || probeErr?.name === 'TimeoutError') {
      failureCategory = 'CONNECTION_TIMEOUT';
      diagnosticsDetail = 'Connection timed out while contacting Supabase endpoint.';
    } else if (errMsg.includes('certificate') || errMsg.includes('TLS') || errMsg.includes('SSL')) {
      failureCategory = 'TLS_NETWORK_FAILURE';
      diagnosticsDetail = 'TLS/SSL handshake negotiation failed.';
    }

    return {
      SUPABASE_URL: 'CONFIGURED',
      SUPABASE_ANON_KEY: 'CONFIGURED',
      SUPABASE_CLIENT: 'FAILED',
      DATABASE_QUERY: 'FAIL',
      AUTH_SERVICE: 'FAILED',
      missingVariableNames: [],
      failureCategory,
      diagnosticsDetail,
      hasServiceRoleKey,
      supabaseUrlStatus: 'CONFIGURED',
      supabaseClientStatus: 'FAILED',
      databaseQueryStatus: 'FAIL',
      authServiceStatus: 'FAILED'
    };
  }

  // Database query probe with client
  try {
    const client = createClient(url, key);
    const { error } = await client.from('clients').select('id').limit(1);

    if (error) {
      let failureCategory: SupabaseDiagnosticStatus['failureCategory'] = 'DATABASE_QUERY_ERROR';
      let diagnosticsDetail = `Database query returned error code ${error.code || 'unknown'}.`;

      if (error.code === '42P01') {
        failureCategory = 'TABLE_NOT_FOUND';
        diagnosticsDetail = 'Database table "clients" was not found. Please apply migrations.';
      } else if (error.code === '42501' || error.message?.includes('permission')) {
        failureCategory = 'RLS_PERMISSION_DENIED';
        diagnosticsDetail = 'Row-Level Security prevented public table read. Consider configuring SUPABASE_SERVICE_ROLE_KEY for server operations.';
      }

      // RLS permission denial or PGRST116 is acceptable for a ping check
      const querySuccess = error.code === 'PGRST116' || (error.message && error.message.includes('permission'));

      return {
        SUPABASE_URL: 'CONFIGURED',
        SUPABASE_ANON_KEY: 'CONFIGURED',
        SUPABASE_CLIENT: 'CONNECTED',
        DATABASE_QUERY: querySuccess ? 'PASS' : 'FAIL',
        AUTH_SERVICE: 'AVAILABLE',
        missingVariableNames: [],
        failureCategory: querySuccess ? 'NONE' : failureCategory,
        diagnosticsDetail: querySuccess ? undefined : diagnosticsDetail,
        hasServiceRoleKey,
        supabaseUrlStatus: 'CONFIGURED',
        supabaseClientStatus: 'CONNECTED',
        databaseQueryStatus: querySuccess ? 'PASS' : 'FAIL',
        authServiceStatus: 'AVAILABLE'
      };
    }

    return {
      SUPABASE_URL: 'CONFIGURED',
      SUPABASE_ANON_KEY: 'CONFIGURED',
      SUPABASE_CLIENT: 'CONNECTED',
      DATABASE_QUERY: 'PASS',
      AUTH_SERVICE: 'AVAILABLE',
      missingVariableNames: [],
      failureCategory: 'NONE',
      hasServiceRoleKey,
      supabaseUrlStatus: 'CONFIGURED',
      supabaseClientStatus: 'CONNECTED',
      databaseQueryStatus: 'PASS',
      authServiceStatus: 'AVAILABLE'
    };
  } catch (dbErr: any) {
    return {
      SUPABASE_URL: 'CONFIGURED',
      SUPABASE_ANON_KEY: 'CONFIGURED',
      SUPABASE_CLIENT: 'FAILED',
      DATABASE_QUERY: 'FAIL',
      AUTH_SERVICE: 'FAILED',
      missingVariableNames: [],
      failureCategory: 'DATABASE_QUERY_ERROR',
      diagnosticsDetail: 'Unexpected exception during database ping query.',
      hasServiceRoleKey,
      supabaseUrlStatus: 'CONFIGURED',
      supabaseClientStatus: 'FAILED',
      databaseQueryStatus: 'FAIL',
      authServiceStatus: 'FAILED'
    };
  }
}


