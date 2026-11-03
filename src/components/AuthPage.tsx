import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { supabaseSignIn, supabaseSignUp, resetPassword, updateUserPassword } from '../services/auth';
import { Database, ShieldCheck, Zap, Users, AlertCircle, CheckCircle2, Loader2, ArrowLeft, KeyRound, Mail, Lock, User } from 'lucide-react';

interface AuthPageProps {
  onSuccess: () => void;
}

type AuthView = 'sign_in' | 'sign_up' | 'forgot_password' | 'reset_password';

export const AuthPage: React.FC<AuthPageProps> = ({ onSuccess }) => {
  const [view, setView] = useState<AuthView>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      const path = window.location.pathname;
      if (path === '/reset-password' || hash.includes('type=recovery')) {
        setView('reset_password');
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (view === 'sign_in') {
        await supabaseSignIn(email, password);
        onSuccess();
      } else if (view === 'sign_up') {
        await supabaseSignUp(email, password, fullName);
        setSuccessMessage('Account created successfully! You are now signed in.');
        onSuccess();
      } else if (view === 'forgot_password') {
        await resetPassword(email);
        setSuccessMessage('Password reset email sent! Check your inbox for instructions.');
      } else if (view === 'reset_password') {
        await updateUserPassword(password);
        setSuccessMessage('Your password has been updated successfully.');
        setTimeout(() => {
          setView('sign_in');
          setSuccessMessage(null);
        }, 2000);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
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
                  <p className="text-slate-400 text-xs mt-0.5">Strict Row-Level Security and workspace isolation across organizations.</p>
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

          <div className="relative z-10 mt-10 pt-6 border-t border-slate-800 text-slate-500 text-xs flex items-center justify-between">
            <span>© 2026 LinkedIn Lead Finder Platform.</span>
            <div className="flex gap-3">
              <a href="/privacy" className="hover:text-slate-400 transition-colors">Privacy</a>
              <a href="/terms" className="hover:text-slate-400 transition-colors">Terms</a>
            </div>
          </div>
        </div>

        {/* Right Side: Auth Form */}
        <div className="lg:w-1/2 p-8 lg:p-12 flex flex-col justify-center bg-slate-50">
          <div className="max-w-md w-full mx-auto space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-2xl font-bold text-slate-900">
                {view === 'sign_in' && 'Welcome Back'}
                {view === 'sign_up' && 'Create Account'}
                {view === 'forgot_password' && 'Reset Password'}
                {view === 'reset_password' && 'Set New Password'}
              </h3>
              <p className="text-slate-500 text-xs mt-1">
                {view === 'sign_in' && 'Sign in with your email and password to access your workspaces.'}
                {view === 'sign_up' && 'Create a new account to get started with multi-tenant lead research.'}
                {view === 'forgot_password' && 'Enter your email address to receive password reset instructions.'}
                {view === 'reset_password' && 'Enter a new secure password for your account.'}
              </p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-xs border border-slate-200">
              {supabase ? (
                <div className="space-y-4">
                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700 text-xs">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <div className="leading-relaxed font-medium">{error}</div>
                    </div>
                  )}

                  {successMessage && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-emerald-800 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="leading-relaxed font-medium">{successMessage}</div>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {view === 'sign_up' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                        <div className="relative">
                          <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                          <input
                            type="text"
                            placeholder="John Doe"
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                            required
                          />
                        </div>
                      </div>
                    )}

                    {(view === 'sign_in' || view === 'sign_up' || view === 'forgot_password') && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                        <div className="relative">
                          <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                          <input
                            type="email"
                            placeholder="you@company.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                            required
                          />
                        </div>
                      </div>
                    )}

                    {(view === 'sign_in' || view === 'sign_up' || view === 'reset_password') && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs font-semibold text-slate-700">
                            {view === 'reset_password' ? 'New Password' : 'Password'}
                          </label>
                          {view === 'sign_in' && (
                            <button
                              type="button"
                              onClick={() => {
                                setView('forgot_password');
                                setError(null);
                                setSuccessMessage(null);
                              }}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                            >
                              Forgot password?
                            </button>
                          )}
                        </div>
                        <div className="relative">
                          <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                          <input
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                            required
                            minLength={6}
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors text-sm shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                        </>
                      ) : (
                        <>
                          {view === 'sign_in' && 'Sign In'}
                          {view === 'sign_up' && 'Create Account'}
                          {view === 'forgot_password' && 'Send Reset Email'}
                          {view === 'reset_password' && 'Update Password'}
                        </>
                      )}
                    </button>
                  </form>

                  {/* Mode Navigation */}
                  <div className="pt-3 text-center border-t border-slate-100 mt-4">
                    {view === 'sign_in' && (
                      <p className="text-xs text-slate-500">
                        Don't have an account?{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setView('sign_up');
                            setError(null);
                            setSuccessMessage(null);
                          }}
                          className="font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                        >
                          Sign Up
                        </button>
                      </p>
                    )}

                    {view === 'sign_up' && (
                      <p className="text-xs text-slate-500">
                        Already have an account?{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setView('sign_in');
                            setError(null);
                            setSuccessMessage(null);
                          }}
                          className="font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                        >
                          Sign In
                        </button>
                      </p>
                    )}

                    {(view === 'forgot_password' || view === 'reset_password') && (
                      <button
                        type="button"
                        onClick={() => {
                          setView('sign_in');
                          setError(null);
                          setSuccessMessage(null);
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
                      </button>
                    )}
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
