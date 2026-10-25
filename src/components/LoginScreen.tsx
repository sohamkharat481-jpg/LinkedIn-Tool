import React, { useState } from 'react';
import { Sparkles, Building2, ShieldCheck, FileSpreadsheet, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

interface LoginScreenProps {
  onSignInWithGoogle: () => Promise<void>;
  onContinueAsGuest: () => Promise<void>;
  authError: string | null;
  onClearError: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onSignInWithGoogle,
  onContinueAsGuest,
  authError,
  onClearError
}) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authMode, setAuthMode] = useState<'google' | 'guest' | null>(null);

  const handleGoogleClick = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    setAuthMode('google');
    onClearError();
    try {
      await onSignInWithGoogle();
    } catch (err) {
      console.warn('Google sign in handler exception:', err);
    } finally {
      setIsAuthenticating(false);
      setAuthMode(null);
    }
  };

  const handleGuestClick = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    setAuthMode('guest');
    onClearError();
    try {
      await onContinueAsGuest();
    } catch (err) {
      console.warn('Guest sign in handler exception:', err);
    } finally {
      setIsAuthenticating(false);
      setAuthMode(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-blue-500 selection:text-white">
      {/* Background Subtle Mesh / Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/30 via-slate-900 to-slate-950 pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center space-y-3">
        {/* Brand Logo */}
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-xl shadow-blue-500/20 mb-2">
          <Building2 className="w-7 h-7" />
        </div>

        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          LinkedIn Lead Finder
        </h2>
        <p className="text-sm text-slate-400 font-medium max-w-sm mx-auto">
          Automated B2B Lead Discovery, Verification & Direct Google Sheets Integration
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="bg-slate-800/80 backdrop-blur-md py-8 px-6 shadow-2xl rounded-2xl border border-slate-700/60 space-y-6 sm:px-10">
          
          {/* Error Notification */}
          {authError && (
            <div className="p-4 bg-red-900/40 border border-red-500/50 rounded-xl text-xs text-red-200 flex items-start gap-3 animate-fadeIn">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <p className="font-bold text-red-300">Authentication Failed</p>
                <p className="leading-relaxed">{authError}</p>
              </div>
            </div>
          )}

          {/* Feature Badges */}
          <div className="space-y-2.5 py-1 border-y border-slate-700/50">
            <div className="flex items-center gap-2.5 text-xs text-slate-300 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Isolated Workspace & Client Management</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-slate-300 font-medium">
              <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Live B2B & Executive Contact Extraction</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-slate-300 font-medium">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Direct Google Sheets Export & Deduplication</span>
            </div>
          </div>

          {/* Sign-In Actions */}
          <div className="space-y-3 pt-2">
            {/* Primary Google Sign In Button */}
            <button
              type="button"
              disabled={isAuthenticating}
              onClick={handleGoogleClick}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl text-sm font-bold text-slate-900 bg-white hover:bg-slate-100 active:bg-slate-200 transition-all shadow-lg hover:shadow-xl disabled:opacity-60 cursor-pointer"
            >
              {isAuthenticating && authMode === 'google' ? (
                <>
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  <span>Signing in with Google...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </>
              )}
            </button>

            {/* Divider */}
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-700" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-slate-800 px-2 text-slate-400 font-semibold">Or</span>
              </div>
            </div>

            {/* Secondary Guest Access Button */}
            <button
              type="button"
              disabled={isAuthenticating}
              onClick={handleGuestClick}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-300 bg-slate-700/60 hover:bg-slate-700 hover:text-white transition-all border border-slate-600/50 disabled:opacity-60 cursor-pointer"
            >
              {isAuthenticating && authMode === 'guest' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Setting up Guest Workspace...</span>
                </>
              ) : (
                <>
                  <span>Continue as Guest</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>

          <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
            <p className="leading-normal">
              Isolated workspace created automatically upon login or guest access.
            </p>
            <div className="flex items-center gap-3 shrink-0 font-medium">
              <a
                href="/privacy"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.pushState({}, '', '/privacy');
                  window.dispatchEvent(new Event('popstate'));
                }}
                className="hover:text-blue-400 transition-colors underline decoration-slate-600 hover:decoration-blue-400"
              >
                Privacy Policy
              </a>
              <span>·</span>
              <a
                href="/terms"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.pushState({}, '', '/terms');
                  window.dispatchEvent(new Event('popstate'));
                }}
                className="hover:text-blue-400 transition-colors underline decoration-slate-600 hover:decoration-blue-400"
              >
                Terms of Service
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
