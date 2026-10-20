import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

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
      console.warn('Redirect result handling warning:', err);
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

      // User is authenticated in Firebase but has no active Google Sheets OAuth token
      if (!isSigningIn && onFailure) {
        onFailure();
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
    console.error('Google Sign-In Error:', error);
    if (error.code === 'auth/popup-closed-by-user') {
      throw new Error('Sign-in cancelled: The authorization popup was closed before completion.');
    }
    if (error.code === 'auth/unauthorized-domain') {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'current domain';
      throw new Error(
        `Domain (${hostname}) is not authorized in Firebase Console -> Authentication -> Settings -> Authorized Domains.`
      );
    }
    if (error.code === 'auth/cancelled-popup-request') {
      throw new Error('Sign-in conflict: another popup was already open. Please retry.');
    }
    throw error;
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

