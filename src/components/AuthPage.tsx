import React, { useState } from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '../services/supabase';
import { Database, ShieldCheck, Zap, Users, AlertCircle } from 'lucide-react';

interface AuthPageProps {
  onSuccess: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onSuccess }) => {
  const [view, setView] = useState<'sign_in' | 'sign_up'>('sign_in');

  // Diagnostic
  React.useEffect(() => {
    console.log('[Diagnostic] Env vars detected in browser:', {
      hasViteSupabaseUrl: !!import.meta.env.VITE_SUPABASE_URL,
      hasViteSupabaseAnonKey: !!import.meta.env.VITE_SUPABASE_ANON_KEY,
      allEnvKeys: Object.keys(import.meta.env || {}),
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
      <div className="max-w-6xl w-full flex flex-col lg:flex-row bg-white rounded-3xl shadow-2xl overflow-hidden min-h-[600px]">
        {/* Left Side: Branding & Features */}
        <div className="lg:w-1/2 bg-slate-900 p-8 lg:p-12 text-white flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
          
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
            
            <div className="space-y-6 mt-12">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-slate-800 rounded-lg">
                  <ShieldCheck className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-100">Enterprise Isolation</h3>
                  <p className="text-slate-400 text-sm">Every organization has completely independent data and strict RLS security.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="p-2 bg-slate-800 rounded-lg">
                  <Users className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-100">Team Collaboration</h3>
                  <p className="text-slate-400 text-sm">Invite members, assign roles, and manage permissions within your tenant.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="p-2 bg-slate-800 rounded-lg">
                  <Zap className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-100">Deterministic Onboarding</h3>
                  <p className="text-slate-400 text-sm">Instant workspace provisioning for every new business account.</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="relative z-10 mt-12 pt-8 border-t border-slate-800 text-slate-500 text-xs">
            © 2026 LinkedIn Lead Finder Platform. All rights reserved.
          </div>
        </div>

        {/* Right Side: Auth UI */}
        <div className="lg:w-1/2 p-8 lg:p-16 flex flex-col justify-center bg-slate-50">
          <div className="max-w-md w-full mx-auto space-y-6">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-slate-900">
                {view === 'sign_in' ? 'Welcome Back' : 'Create Organization'}
              </h3>
              <p className="text-slate-500 mt-2">
                {view === 'sign_in' 
                  ? 'Sign in to access your dashboard and leads.' 
                  : 'Start your 14-day trial. No credit card required.'}
              </p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
              {supabase ? (
                <Auth
                  supabaseClient={supabase}
                  appearance={{
                    theme: ThemeSupa,
                    variables: {
                      default: {
                        colors: {
                          brand: '#2563eb',
                          brandAccent: '#1d4ed8',
                          inputBackground: '#f8fafc',
                          inputText: '#0f172a',
                          inputBorder: '#e2e8f0',
                          inputPlaceholder: '#94a3b8',
                        },
                        radii: {
                          borderRadiusButton: '12px',
                        },
                        fonts: {
                          bodyFontFamily: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`,
                          buttonFontFamily: `Inter, ui-sans-serif, system-ui`,
                          inputFontFamily: `Inter, ui-sans-serif, system-ui`,
                        }
                      }
                    },
                    className: {
                      container: 'flex flex-col gap-4',
                      button: 'font-bold tracking-tight',
                      input: 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 transition-all',
                      label: 'text-xs font-bold text-slate-500 uppercase tracking-wider mb-1',
                    }
                  }}
                  providers={['google']}
                  redirectTo={window.location.origin}
                  onlyThirdPartyProviders={false}
                  view={view}
                />
              ) : (
                <div className="text-center py-4 space-y-4">
                  <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <h4 className="font-bold text-slate-900">Database Configuration Missing</h4>
                  <p className="text-sm text-slate-500">
                    Supabase URL and API key are not configured. Please check your environment variables (SUPABASE_URL, SUPABASE_ANON_KEY).
                  </p>
                </div>
              )}
            </div>

            <div className="text-center">
              <p className="text-slate-400 text-[10px] leading-relaxed uppercase font-bold tracking-widest px-8">
                By continuing, you agree to our <a href="/terms" className="text-blue-600 hover:underline">Terms of Service</a> and <a href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</a>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
