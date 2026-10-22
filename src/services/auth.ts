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

/**
 * Validates the OAuth access token directly with Google API to confirm the connection is genuine.
 * Never reports Connected without verifying live with Google.
 */
export const verifyGoogleAccountConnection = async (token: string): Promise<GoogleAccountInfo> => {
  if (!token || token.trim().length < 10) {
    throw new Error('Invalid or missing OAuth token.');
  }

  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Google OAuth token is expired or unauthorized. Please re-authenticate.');
    }
    throw new Error(`Google account verification failed (HTTP ${res.status}).`);
  }

  const data = await res.json();
  if (!data.email) {
    throw new Error('Google account returned no verified email address.');
  }

  return {
    email: data.email,
    name: data.name || data.email.split('@')[0],
    picture: data.picture,
    verifiedEmail: Boolean(data.email_verified)
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
 * Sign in with Google popup (with automatic redirect fallback for blocked popups in iframes) and verify OAuth token live against Google API.
 */
export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
  account: GoogleAccountInfo;
} | null> => {
  try {
    isSigningIn = true;
    const activeCfg = getResolvedFirebaseConfig();
    if (
      activeCfg.projectId === 'linkedin-tool-510912' &&
      (activeCfg.appId.includes('868647160060') || activeCfg.apiKey === 'AIzaSyAIOhDtP8yjvPTFdepJ9n9Wh0pbN3Os8rQ')
    ) {
      console.warn(
        '[Firebase Configuration Mismatch] Project ID is "linkedin-tool-510912", but API key or App ID belongs to project 868647160060 (project-8f9ec042-024f-49a1-9f1). This causes auth/unauthorized-domain until genuine Web App credentials for linkedin-tool-510912 are provided.'
      );
    }

    let result;
    try {
      result = await signInWithPopup(auth, provider);
    } catch (popupError: any) {
      if (popupError?.code === 'auth/popup-blocked') {
        console.warn('Popup blocked by browser (iframe environment). Falling back to signInWithRedirect...');
        await signInWithRedirect(auth, provider);
        return null;
      }
      throw popupError;
    }

    const credential = GoogleAuthProvider.credentialFromResult(result);

    if (!credential?.accessToken) {
      throw new Error(
        'Google sign-in succeeded, but Google Sheets OAuth access token was not returned. Please ensure spreadsheet permissions are approved.'
      );
    }

    // Step 2: Live confirmation against Google API before returning
    const verifiedAccount = await verifyGoogleAccountConnection(credential.accessToken);

    cachedAccessToken = credential.accessToken;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_TOKEN_KEY, credential.accessToken);
    }

    return {
      user: result.user,
      accessToken: cachedAccessToken,
      account: verifiedAccount
    };
  } catch (error: any) {
    const activeCfg = getResolvedFirebaseConfig();
    const runtimeOptions = auth.app.options;
    const rawKey = activeCfg.apiKey || runtimeOptions.apiKey || '';
    const keyPrefix = rawKey.length > 8 ? `${rawKey.substring(0, 8)}...` : (rawKey || 'none');

    console.error('Google Sign-In Diagnostic Failure:', {
      errorCode: error?.code || 'unknown',
      errorMessage: error?.message || 'unknown',
      configProjectId: activeCfg.projectId,
      configAuthDomain: activeCfg.authDomain,
      runtimeProjectId: runtimeOptions.projectId,
      runtimeAuthDomain: runtimeOptions.authDomain,
      hostname: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
      apiKeyPrefix: keyPrefix,
      runtimeAppId: runtimeOptions.appId || activeCfg.appId || 'none'
    });
    if (error?.code === 'auth/popup-closed-by-user') {
      throw new Error('Sign-in cancelled: The authorization popup was closed before completion.');
    }
    if (error?.code === 'auth/unauthorized-domain') {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'current domain';
      throw new Error(
        `Domain (${hostname}) is not authorized in Firebase Console -> Authentication -> Settings -> Authorized Domains (Project: ${runtimeOptions.projectId || activeCfg.projectId}). Please ensure the apiKey and appId in firebase-applet-config.json match the Web App settings in your Firebase Console project where this domain is authorized.`
      );
    }
    if (error?.code === 'auth/cancelled-popup-request') {
      throw new Error('Sign-in conflict: another popup was already open. Please retry.');
    }
    if (error?.code === 'auth/operation-not-allowed') {
      throw new Error('Google Sign-In is not enabled in the Firebase Console under Authentication -> Sign-in method.');
    }
    throw new Error(error?.message || 'Google authentication failed.');
  } finally {
    isSigningIn = false;
  }
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
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('Firebase signOut error:', e);
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

