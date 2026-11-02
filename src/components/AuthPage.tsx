import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { supabaseSignIn, supabaseSignUp, supabaseGoogleSignIn } from '../services/auth';
import { Database, ShieldCheck, Zap, Users, AlertCircle, Loader2 } from 'lucide-react';

interface AuthPageProps {
  onSuccess: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onSuccess }) => {
  const [view, setView] = useState<'sign_in' | 'sign_up'>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (view === 'sign_in') {
        await supabaseSignIn(email, password);
      } else {
        await supabaseSignUp(email, password, fullName);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'An error occurred during sign in.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (googleLoading || loading) return;
    setGoogleLoading(true);
    setError(null);
    try {
      await supabaseGoogleSignIn();
    } catch (err: any) {
      let msg = err.message || 'An error occurred during Google sign in.';
      if (msg.includes('Unsupported provider') || msg.includes('not enabled')) {
        msg = 'Google Sign-In is not enabled in your Supabase project. Please enable Google provider in the Supabase Dashboard under Authentication -> Providers.';
      }
      setError(msg);
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
      <div className="max-w-6xl w-full flex flex-col lg:flex-row bg-white rounded-3xl shadow-2xl overflow-hidden min-h-[600px]">
        {/* Left Side: Branding & Features */}
        <div className="lg:w-1/2 bg-slate-900 p-8 lg:p-12 text-white flex flex-col justify-between relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2.5 bg-blue-600 rounded-xl shadow-lg shadow-blue-600/30">
                <Database className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">LinkedIn Lead Finder</h1>
            </div>
            
            <h2 className="text-3xl lg:text-4xl font-extrabold leading-tight mb-6">
              The Multi-Tenant <span className="text-blue-400">SaaS Solution</span> for B2B Growth.
            </h2>

            <div className="space-y-5 mt-8">
              <div className="flex items-start gap-3.5">
                <div className="p-2 bg-slate-800 rounded-lg shrink-0">
                  <ShieldCheck className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-100">Enterprise Isolation</h3>
                  <p className="text-slate-400 text-xs mt-0.5">Strict RLS security and workspace isolation across organizations.</p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <div className="p-2 bg-slate-800 rounded-lg shrink-0">
                  <Users className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-100">Client Directory & Multi-Tenant Context</h3>
                  <p className="text-slate-400 text-xs mt-0.5">Manage multiple client workspaces with separated lead records.</p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <div className="p-2 bg-slate-800 rounded-lg shrink-0">
                  <Zap className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-100">Instant Lead Discovery & Export</h3>
                  <p className="text-slate-400 text-xs mt-0.5">Real SPARQL B2B lead discovery with direct Google Sheets integration.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-10 pt-6 border-t border-slate-800 text-slate-500 text-xs">
            © 2026 LinkedIn Lead Finder Platform. All rights reserved.
          </div>
        </div>

        {/* Right Side: Auth Form */}
        <div className="lg:w-1/2 p-8 lg:p-12 flex flex-col justify-center bg-slate-50">
          <div className="max-w-md w-full mx-auto space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-2xl font-bold text-slate-900">
                {view === 'sign_in' ? 'Welcome Back' : 'Create Account'}
              </h3>
              <p className="text-slate-500 text-xs mt-1">
                {view === 'sign_in'
                  ? 'Sign in to access your organization workspaces and lead databases.'
                  : 'Get started with isolated workspace lead research.'}
              </p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-xs border border-slate-200">
              {supabase ? (
                <div className="space-y-4">
                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700 text-xs">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <div className="leading-relaxed">{error}</div>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-3.5">
                    {view === 'sign_up' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                        <input
                          type="text"
                          placeholder="John Doe"
                          value={fullName}
                          onChange={e => setFullName(e.target.value)}
                          className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                          required
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                      <input
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors text-sm shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      disabled={loading || googleLoading}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                        </>
                      ) : (
                        view === 'sign_in' ? 'Sign In' : 'Sign Up'
                      )}
                    </button>
                  </form>

                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-slate-200"></div>
                    <span className="flex-shrink mx-3 text-slate-400 text-xs font-medium uppercase tracking-wider">or</span>
                    <div className="flex-grow border-t border-slate-200"></div>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={loading || googleLoading}
                    className="w-full bg-white hover:bg-slate-50 text-slate-700 font-semibold py-2.5 px-4 border border-slate-200 rounded-xl transition-colors text-sm flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50"
                  >
                    {googleLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> Redirecting to Google...
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
                        Sign in with Google
                      </>
                    )}
                  </button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setView(view === 'sign_in' ? 'sign_up' : 'sign_in');
                        setError(null);
                      }}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                    >
                      {view === 'sign_in' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 space-y-3">
                  <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm">Database Configuration Missing</h4>
                  <p className="text-xs text-slate-500">
                    Supabase URL and API key are not configured. Please check your environment variables (SUPABASE_URL, SUPABASE_ANON_KEY).
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
