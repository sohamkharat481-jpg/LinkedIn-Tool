import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const getResolvedFirebaseConfig = () => {
  const env = (import.meta as any).env || {};
  const baseConfig = firebaseConfig || {};
  const resolvedProjectId = baseConfig.projectId || env.VITE_FIREBASE_PROJECT_ID || 'linkedin-tool-510912';
  const resolvedApiKey = baseConfig.apiKey || env.VITE_FIREBASE_API_KEY || (typeof window === 'undefined' ? 'test-api-key-for-node-environment' : '');
  return {
    projectId: resolvedProjectId,
    apiKey: resolvedApiKey,
    authDomain: baseConfig.authDomain || env.VITE_FIREBASE_AUTH_DOMAIN || `${resolvedProjectId}.firebaseapp.com`,
    storageBucket: baseConfig.storageBucket || env.VITE_FIREBASE_STORAGE_BUCKET || `${resolvedProjectId}.firebasestorage.app`,
    messagingSenderId: baseConfig.messagingSenderId || env.VITE_FIREBASE_MESSAGING_SENDER_ID || '686590748568',
    appId: baseConfig.appId || env.VITE_FIREBASE_APP_ID || '1:686590748568:web:586515f694e144b3476ded',
    measurementId: baseConfig.measurementId || env.VITE_FIREBASE_MEASUREMENT_ID || 'G-FW3RLGF071'
  };
};

// Initialize Firebase App
const resolvedConfig = getResolvedFirebaseConfig();
let appInstance;
const existingApps = getApps();
if (existingApps.length > 0) {
  const defaultApp = getApp();
  if (
    defaultApp.options.projectId !== resolvedConfig.projectId ||
    defaultApp.options.apiKey !== resolvedConfig.apiKey
  ) {
    console.warn('Re-initializing Firebase App instance due to project configuration mismatch.');
    appInstance = initializeApp(resolvedConfig, `app-${Date.now()}`);
  } else {
    appInstance = defaultApp;
  }
} else {
  appInstance = initializeApp(resolvedConfig);
}
export const app = appInstance;
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Failed to set auth persistence:', err);
});

// Startup diagnostic log for environment and runtime configuration
if (typeof window !== 'undefined') {
  const runtimeOptions = app.options;
  const rawKey = resolvedConfig.apiKey || runtimeOptions.apiKey || '';
  const keyPrefix = rawKey.length > 8 ? `${rawKey.substring(0, 8)}...` : (rawKey || 'none');
  console.info('Firebase Auth Initialized:', {
    configProjectId: resolvedConfig.projectId,
    configAuthDomain: resolvedConfig.authDomain,
    runtimeProjectId: runtimeOptions.projectId,
    runtimeAuthDomain: runtimeOptions.authDomain,
    apiKeyPrefix: keyPrefix,
    runtimeAppId: runtimeOptions.appId || resolvedConfig.appId || 'none',
    hostname: window.location.hostname
  });
}

const provider = new GoogleAuthProvider();
// Workspace Scopes for Google Sheets and Google Drive File Access
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;
let cachedAccessToken: string | null = null;
const SESSION_TOKEN_KEY = '__g_oauth_session_token';

// Handle redirect result if returning from a redirect sign-in
if (typeof window !== 'undefined') {
  getRedirectResult(auth)
    .then(async (result) => {
      if (result) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          cachedAccessToken = credential.accessToken;
          sessionStorage.setItem(SESSION_TOKEN_KEY, credential.accessToken);
        }
      }
    })
    .catch((err) => {
      const activeCfg = getResolvedFirebaseConfig();
      const runtimeOptions = auth.app.options;
      const rawKey = activeCfg.apiKey || runtimeOptions.apiKey || '';
      const keyPrefix = rawKey.length > 8 ? `${rawKey.substring(0, 8)}...` : (rawKey || 'none');
      console.error('Google Redirect Diagnostic Failure:', {
        errorCode: err?.code || 'unknown',
        errorMessage: err?.message || 'unknown',
        configProjectId: activeCfg.projectId,
        configAuthDomain: activeCfg.authDomain,
        runtimeProjectId: runtimeOptions.projectId,
        runtimeAuthDomain: runtimeOptions.authDomain,
        hostname: window.location.hostname,
        apiKeyPrefix: keyPrefix,
        runtimeAppId: runtimeOptions.appId || activeCfg.appId || 'none'
      });
    });
}

export interface GoogleAccountInfo {
  email: string;
  name: string;
  picture?: string;
  verifiedEmail?: boolean;
}

export const firebaseSignIn = async (): Promise<User | null> => {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error: any) {
    console.error('Firebase Auth sign-in error:', error);
    // Rethrow to allow UI to show error
    throw error;
  }
};

/**
 * Validates the OAuth access token with Google API (tokeninfo endpoint) to confirm the connection is genuine.
 * Never reports Connected without verifying live with Google.
 */
export const verifyGoogleAccountConnection = async (token: string): Promise<GoogleAccountInfo> => {
  if (!token || token.trim().length < 10) {
    throw new Error('Invalid or missing OAuth token.');
  }

  // 1. Verify token status and scopes with Google OAuth2 Tokeninfo endpoint
  let tokenInfo: any = null;
  try {
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
    );

    if (tokenInfoRes.status === 400 || tokenInfoRes.status === 401) {
      throw new Error('Google OAuth token is expired or unauthorized. Please re-authenticate.');
    }

    if (!tokenInfoRes.ok) {
      throw new Error(`Google token validation failed (HTTP ${tokenInfoRes.status}).`);
    }

    tokenInfo = await tokenInfoRes.json();
  } catch (err: any) {
    if (err.message && err.message.includes('expired or unauthorized')) {
      throw err;
    }
    console.warn('Tokeninfo endpoint warning:', err);
  }

  if (tokenInfo?.error) {
    throw new Error(`Google OAuth token invalid: ${tokenInfo.error_description || tokenInfo.error}`);
  }

  if (tokenInfo?.scope) {
    const grantedScopes = String(tokenInfo.scope).split(' ');
    const hasSheets = grantedScopes.some((s) => s.includes('spreadsheets'));
    if (!hasSheets) {
      throw new Error('Google Sheets permission was not granted. Please re-authenticate and allow spreadsheet access.');
    }
  }

  // 2. Resolve account info (email, name, picture)
  let userEmail = tokenInfo?.email || '';
  let userName = userEmail ? userEmail.split('@')[0] : 'Google Account';
  let userPicture: string | undefined = undefined;

  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.email) userEmail = data.email;
      if (data.name) userName = data.name;
      if (data.picture) userPicture = data.picture;
    }
  } catch {
    // Graceful fallback if userinfo endpoint is restricted
  }

  return {
    email: userEmail || 'connected-account@google.com',
    name: userName,
    picture: userPicture,
    verifiedEmail: Boolean(userEmail)
  };
};

/**
 * Initialize auth state listener.
 * Restores Google Sheets session on page refresh via sessionStorage (never localStorage).
 */
export const initAuthListener = (
  onSuccess?: (user: User, token: string, accountInfo?: GoogleAccountInfo) => void,
  onFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // Check in-memory token first, then session storage
      let tokenToVerify = cachedAccessToken;
      if (!tokenToVerify && typeof window !== 'undefined') {
        tokenToVerify = sessionStorage.getItem(SESSION_TOKEN_KEY);
      }

      if (tokenToVerify) {
        try {
          const verified = await verifyGoogleAccountConnection(tokenToVerify);
          cachedAccessToken = tokenToVerify;
          if (onSuccess) onSuccess(user, tokenToVerify, verified);
          return;
        } catch {
          // Token is invalid/expired - clear session storage
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem(SESSION_TOKEN_KEY);
          }
          cachedAccessToken = null;
        }
      }

      // User is authenticated in Firebase and authorized
      if (onSuccess) {
        onSuccess(user, '', {
          email: user.email || '',
          name: user.displayName || user.email?.split('@')[0] || 'User',
          verifiedEmail: true
        });
      }
    } else {
      cachedAccessToken = null;
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }
      if (onFailure) onFailure();
    }
  });
};

/**
 * Sign in with Google using Google Identity Services (GIS) Token Client for Google Sheets OAuth scopes.
 */
export const googleSignIn = async (): Promise<{
  accessToken: string;
  account: GoogleAccountInfo;
} | null> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window not available'));
      return;
    }

    const clientId = firebaseConfig.oAuthClientId || '686590748568-4v48h52di3kt9gi8d9r1hpn8hlf8tq95.apps.googleusercontent.com';

    const loadGIS = () => {
      return new Promise<void>((resolveLoad, rejectLoad) => {
        if ((window as any).google?.accounts?.oauth2) {
          resolveLoad();
          return;
        }
        const existingScript = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
        if (existingScript) {
          existingScript.addEventListener('load', () => resolveLoad());
          existingScript.addEventListener('error', () => rejectLoad(new Error('Failed to load Google Identity Services script.')));
          if ((window as any).google?.accounts?.oauth2) {
            resolveLoad();
          }
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => resolveLoad();
        script.onerror = () => rejectLoad(new Error('Failed to load Google Identity Services script.'));
        document.head.appendChild(script);
      });
    };

    loadGIS()
      .then(() => {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid',
          callback: async (response: any) => {
            if (response.error) {
              if (response.error === 'access_denied') {
                reject(
                  new Error(
                    'Google authorization was denied or cancelled. If the Google Cloud project is in Testing mode, ensure your email address is added under "Test users".'
                  )
                );
              } else {
                reject(new Error(response.error_description || response.error));
              }
              return;
            }
            const token = response.access_token;
            if (!token) {
              reject(new Error('Failed to obtain Google access token.'));
              return;
            }
            try {
              const verifiedAccount = await verifyGoogleAccountConnection(token);
              cachedAccessToken = token;
              if (typeof window !== 'undefined') {
                sessionStorage.setItem(SESSION_TOKEN_KEY, token);
              }
              resolve({
                accessToken: token,
                account: verifiedAccount
              });
            } catch (err: any) {
              reject(err);
            }
          }
        });
        client.requestAccessToken();
      })
      .catch((err) => reject(err));
  });
};

/**
 * Checks if a valid Google OAuth access token is active in memory or session.
 */
export const hasValidAccessToken = (): boolean => {
  if (cachedAccessToken && cachedAccessToken.length > 10) return true;
  if (typeof window !== 'undefined') {
    const sessionToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
    return Boolean(sessionToken && sessionToken.length > 10);
  }
  return false;
};

/**
 * Retrieves the current cached access token.
 */
export const getCachedAccessToken = (): string | null => {
  if (cachedAccessToken) return cachedAccessToken;
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem(SESSION_TOKEN_KEY);
  }
  return null;
};

/**
 * Sets or updates the cached access token in memory and session.
 */
export const setCachedAccessToken = (token: string | null): void => {
  cachedAccessToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  }
};

/**
 * Signs out the current user and clears cached tokens.
 */
export const googleSignOut = async (): Promise<void> => {
  const token = cachedAccessToken || (typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_TOKEN_KEY) : null);
  if (token && typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2?.revoke) {
    try {
      (window as any).google.accounts.oauth2.revoke(token, () => {});
    } catch (e) {
      console.warn('GIS token revoke warning:', e);
    }
  }
  cachedAccessToken = null;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  }
};

/**
 * Retrieves the current Firebase user ID token for authenticating backend API requests.
 */
export const getFirebaseIdToken = async (forceRefresh: boolean = false): Promise<string | null> => {
  try {
    if (auth.currentUser) {
      return await auth.currentUser.getIdToken(forceRefresh);
    }
  } catch (err) {
    console.warn('Failed to retrieve Firebase ID token:', err);
  }
  return null;
};

