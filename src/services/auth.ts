import { supabase } from './supabase';
import { User, Session } from '@supabase/supabase-js';

export interface GoogleAccountInfo {
  email: string;
  name: string;
  picture?: string;
  verifiedEmail?: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  organization_id?: string;
  role?: string;
}

/**
 * Supabase Auth State Helpers
 */
export const supabaseSignIn = async (email: string, password: string) => {
  if (!supabase) throw new Error('Supabase client not initialized');
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data.user;
};

export const supabaseSignUp = async (email: string, password: string, fullName: string) => {
  if (!supabase) throw new Error('Supabase client not initialized');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName
      }
    }
  });
  if (error) throw error;
  return data.user;
};

export const supabaseGoogleSignIn = async () => {
  if (!supabase) throw new Error('Supabase client not initialized');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent'
      }
    }
  });
  if (error) throw error;
  return data;
};

export const supabaseSignOut = async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  if (typeof window !== 'undefined') {
    sessionStorage.clear();
    localStorage.removeItem('llf_current_org_id');
    localStorage.removeItem('llf_current_workspace_id');
  }
};

export const resetPassword = async (email: string) => {
  if (!supabase) throw new Error('Supabase client not initialized');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`
  });
  if (error) throw error;
};

/**
 * Session and User Resolution
 */
export const getSupabaseSession = async () => {
  if (!supabase) return null;
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) return null;
  return session;
};

export const getSupabaseUser = async () => {
  if (!supabase) return null;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return null;
  return user;
};

/**
 * Retrieves the current Supabase JWT for authenticating backend API requests.
 */
export const getAuthToken = async (): Promise<string | null> => {
  const session = await getSupabaseSession();
  return session?.access_token || null;
};

// Aliases for backward compatibility in services
export const getFirebaseIdToken = getAuthToken;
export const getCachedAccessToken = () => {
    if (typeof window !== 'undefined') {
        return sessionStorage.getItem('__g_oauth_access_token');
    }
    return null;
};

/**
 * Initialization and Listener
 */
export const initAuthListener = (
  onSuccess?: (user: User, token: string, accountInfo?: GoogleAccountInfo) => void,
  onFailure?: () => void
) => {
  if (!supabase) {
    console.warn('Supabase client not initialized. Auth listener disabled.');
    if (onFailure) onFailure();
    return () => {};
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      const token = session.access_token;
      
      // Store Google OAuth token if available in the provider_token
      if (session.provider_token) {
        sessionStorage.setItem('__g_oauth_access_token', session.provider_token);
      }

      if (onSuccess) {
        onSuccess(session.user, token, {
          email: session.user.email || '',
          name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
          picture: session.user.user_metadata?.avatar_url,
          verifiedEmail: true
        });
      }
    } else if (event === 'SIGNED_OUT') {
      if (onFailure) onFailure();
    }
  });

  return () => subscription.unsubscribe();
};

export const googleSignIn = supabaseGoogleSignIn;
export const googleSignOut = supabaseSignOut;
export const verifyGoogleAccountConnection = async (token: string) => {
    return { email: 'connected-account@google.com', name: 'Google Account', verifiedEmail: true };
};
export const setCachedAccessToken = (token: string | null) => {
    if (typeof window !== 'undefined') {
        if (token) sessionStorage.setItem('__g_oauth_access_token', token);
        else sessionStorage.removeItem('__g_oauth_access_token');
    }
};
export const getUserSessionTokenKey = (user?: User | null) => {
    if (user?.id) return `__g_oauth_session_token_${user.id}`;
    return '__g_oauth_session_token_guest';
};

/**
 * Deterministic Fallback JWT Generator (Mock for testing)
 */
export const generateFallbackJwtToken = async (
  email: string = 'sohamkharat481@gmail.com',
  userId: string = 'user-sohamkharat481'
): Promise<string> => {
  return `mock-token-${userId}`;
};
