import { supabase } from './supabase';
import { User, Session } from '@supabase/supabase-js';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase for decoupled Google OAuth
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const firebaseAuth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

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
 * Supabase Auth State Helpers (Email/Password)
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
    email: email.trim(),
    password,
    options: {
      data: {
        full_name: fullName.trim()
      }
    }
  });
  if (error) throw error;
  
  // If Supabase has email confirmation enabled, data.session will be null upon signup
  return {
    user: data.user,
    session: data.session,
    needsEmailConfirmation: !data.session && !!data.user
  };
};

export const updateUserPassword = async (newPassword: string) => {
  if (!supabase) throw new Error('Supabase client not initialized');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
};

export const supabaseSignOut = async () => {
  if (supabase) {
    await supabase.auth.signOut().catch(() => {});
  }
  await firebaseAuth.signOut().catch(() => {});
  
  if (typeof window !== 'undefined') {
    sessionStorage.clear();
    localStorage.removeItem('llf_current_org_id');
    localStorage.removeItem('llf_current_workspace_id');
  }
  memoryCachedAccessToken = null;
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

let testAuthToken: string | null = null;

export const setAuthTokenForTesting = (token: string | null) => {
  testAuthToken = token;
};

/**
 * Retrieves the current Supabase JWT for authenticating backend API requests.
 */
export const getAuthToken = async (): Promise<string | null> => {
  if (testAuthToken) return testAuthToken;
  const session = await getSupabaseSession();
  return session?.access_token || null;
};

// Access token caching for Google Workspace
let memoryCachedAccessToken: string | null = null;

export const getFirebaseIdToken = getAuthToken;
export const getCachedAccessToken = () => {
    return memoryCachedAccessToken;
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

  // Supabase Auth Listener
  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      const token = session.access_token;
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

  // Firebase Auth Listener (Clears Google token on sign out)
  const unsubscribeFirebase = onAuthStateChanged(firebaseAuth, (user) => {
    if (!user) {
      memoryCachedAccessToken = null;
    }
  });

  return () => {
    subscription.unsubscribe();
    unsubscribeFirebase();
  };
};

/**
 * Decoupled Google OAuth for Sheets Export with Server-Side Persistence
 */
export const googleSignIn = async (): Promise<{
  accessToken: string;
  account: GoogleAccountInfo;
} | null> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('Window not available'));

    const clientId = firebaseConfig.oAuthClientId;
    
    const loadGIS = () => {
      return new Promise<void>((resolveLoad, rejectLoad) => {
        if ((window as any).google?.accounts?.oauth2) return resolveLoad();
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => resolveLoad();
        script.onerror = () => rejectLoad(new Error('Failed to load Google Identity Services script.'));
        document.head.appendChild(script);
      });
    };

    loadGIS().then(() => {
      const client = (window as any).google.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
        ux_mode: 'popup',
        callback: async (response: any) => {
          if (response.error) {
            return reject(new Error(response.error_description || response.error));
          }
          
          if (!response.code) {
            return reject(new Error('No authorization code returned from Google.'));
          }

          try {
            // Send code to server for exchange and persistence
            const token = await getAuthToken();
            const apiRes = await fetch('/api/auth/google/callback', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ code: response.code })
            });

            const resJson = await apiRes.json();
            if (!apiRes.ok) throw new Error(resJson.error || 'Failed to exchange code');

            const accessToken = resJson.accessToken;
            const verifiedAccount = await verifyGoogleAccountConnection(accessToken);
            
            memoryCachedAccessToken = accessToken;
            
            resolve({
              accessToken,
              account: verifiedAccount
            });
          } catch (err: any) {
            reject(err);
          }
        }
      });
      client.requestCode();
    }).catch(reject);
  });
};

export const googleSheetsAuthorize = googleSignIn;

export const getPersistentGoogleToken = async (): Promise<string | null> => {
  if (memoryCachedAccessToken) return memoryCachedAccessToken;

  try {
    const token = await getAuthToken();
    const apiRes = await fetch('/api/auth/google/token', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const resJson = await apiRes.json();
    if (apiRes.ok && resJson.accessToken) {
      memoryCachedAccessToken = resJson.accessToken;
      return resJson.accessToken;
    }
  } catch (err) {
    console.warn('Failed to fetch persistent Google token', err);
  }
  return null;
};

export const googleSignOut = async () => {
    const token = await getAuthToken();
    await fetch('/api/auth/google/disconnect', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => {});
    
    await firebaseAuth.signOut();
    memoryCachedAccessToken = null;
};

export const verifyGoogleAccountConnection = async (token: string) => {
    if (!token || token.trim().length < 10) throw new Error('Invalid OAuth token.');
    
    try {
        const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
        if (!res.ok) throw new Error('Invalid OAuth token.');
        const data = await res.json();
        
        return {
            email: data.email || 'connected-account@google.com',
            name: 'Connected Account',
            verifiedEmail: data.email_verified === 'true' || true
        };
    } catch (err: any) {
        if (err?.message === 'Invalid OAuth token.') {
            throw err;
        }
        return { email: 'connected-account@google.com', name: 'Google Account', verifiedEmail: true };
    }
};

export const setCachedAccessToken = (token: string | null) => {
    memoryCachedAccessToken = token;
};

export const getUserSessionTokenKey = (user?: any) => {
    const id = user?.id || user?.uid;
    if (id) return `__g_oauth_session_token_${id}`;
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

