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
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await supabaseGoogleSignIn();
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
      <div className="max-w-6xl w-full flex flex-col lg:flex-row bg-white rounded-3xl shadow-2xl overflow-hidden min-h-[600px]">
        <div className="lg:w-1/2 bg-slate-900 p-8 lg:p-12 text-white flex flex-col justify-between relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-blue-600 rounded-xl">
                <Database className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">LinkedIn Lead Finder</h1>
            </div>
            <h2 className="text-4xl lg:text-5xl font-extrabold leading-tight mb-6">
              The Multi-Tenant <span className="text-blue-500">SaaS Solution</span> for B2B Growth.
            </h2>
          </div>
        </div>

        <div className="lg:w-1/2 p-8 lg:p-16 flex flex-col justify-center bg-slate-50">
          <div className="max-w-md w-full mx-auto space-y-6">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-slate-900">
                {view === 'sign_in' ? 'Welcome Back' : 'Create Organization'}
              </h3>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
              {supabase ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && <div className="text-red-500 text-sm bg-red-50 p-2 rounded">{error}</div>}
                  {view === 'sign_up' && (
                    <input type="text" placeholder="Full Name" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full p-2 border rounded" required />
                  )}
                  <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-2 border rounded" required />
                  <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-2 border rounded" required />
                  
                  <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded font-bold" disabled={loading}>
                    {loading ? <Loader2 className="animate-spin mx-auto" /> : (view === 'sign_in' ? 'Sign In' : 'Sign Up')}
                  </button>

                  <div className="my-4 text-center">or</div>

                  <button type="button" onClick={handleGoogleSignIn} className="w-full border p-2 rounded font-bold" disabled={loading}>
                    Sign in with Google
                  </button>

                  <button type="button" onClick={() => setView(view === 'sign_in' ? 'sign_up' : 'sign_in')} className="w-full text-sm text-blue-600">
                    {view === 'sign_in' ? 'Need an account? Sign Up' : 'Already have an account? Sign In'}
                  </button>
                </form>
              ) : (
                <div className="text-center text-red-600">Database Configuration Missing</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
