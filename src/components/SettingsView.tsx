import React, { useState, useEffect, useRef } from 'react';
import { LeadProviderConfig, Workspace, ProviderStatusInfo, Client } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import {
  Building2,
  Database,
  Key,
  ShieldCheck,
  Sparkles,
  Download,
  CheckCircle2,
  LogOut,
  User,
  RefreshCw,
  Plus,
  FileCode,
  AlertCircle,
  XCircle,
  Activity,
  Server,
  Clock,
  Zap,
  Lock
} from 'lucide-react';
import { googleSignIn, googleSignOut } from '../services/auth';
import { SupabaseDiagnosticStatus, testSupabaseHealth } from '../services/supabase';
import { apiUrl } from '../services/apiClient';

interface SettingsViewProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  onCreateWorkspace: (name: string, desc: string) => void;
  providerConfig: LeadProviderConfig;
  onUpdateProviderConfig: (config: Partial<LeadProviderConfig>) => void;
  currentUser: FirebaseUser | null;
  userEmail: string;
  isGoogleConnected: boolean;
  onGoogleAuthSuccess: (user: FirebaseUser, token: string) => void;
  providerStatus: ProviderStatusInfo;
  onRefreshProviderStatus: () => void;
  clients: Client[];
  activeClient: Client | null;
  onSelectClient: (clientId: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  workspaces,
  activeWorkspace,
  onCreateWorkspace,
  providerConfig,
  onUpdateProviderConfig,
  currentUser,
  userEmail,
  isGoogleConnected,
  onGoogleAuthSuccess,
  providerStatus,
  onRefreshProviderStatus,
  clients,
  activeClient,
  onSelectClient
}) => {
  const [providerType, setProviderType] = useState<LeadProviderConfig['providerType']>('wikidata');
  // Health check test state
  const [isTestingHealth, setIsTestingHealth] = useState(false);
  const [healthTestResult, setHealthTestResult] = useState<ProviderStatusInfo | null>(null);

  // Workspace creation state
  const [isNewWsModalOpen, setIsNewWsModalOpen] = useState(false);
  const [wsNameInput, setWsNameInput] = useState('');
  const [wsDescInput, setWsDescInput] = useState('');

  // Supabase Config & Diagnostics state
  const [supabaseDiag, setSupabaseDiag] = useState<SupabaseDiagnosticStatus | null>(null);

  const fetchSupabaseDiag = async () => {
    try {
      const res = await fetch(apiUrl('/api/supabase-status'));
      if (res.ok) {
        const data = await res.json();
        setSupabaseDiag(data);
      } else {
        const fallback = await testSupabaseHealth();
        setSupabaseDiag(fallback);
      }
    } catch {
      const fallback = await testSupabaseHealth();
      setSupabaseDiag(fallback);
    }
  };

  useEffect(() => {
    fetchSupabaseDiag();
  }, []);

  const handleRunHealthCheck = async () => {
    setIsTestingHealth(true);
    setHealthTestResult(null);
    try {
      const res = await fetch(apiUrl('/api/provider-status/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerType,
          workspaceId: activeWorkspace.id,
          clientId: activeClient?.id || ''
        })
      });
      const data = await res.json();
      setHealthTestResult(data);
      onRefreshProviderStatus();
    } catch (err: any) {
      setHealthTestResult({
        configured: false,
        providerName: 'External Lead API',
        status: 'Error',
        message: err.message || 'Health check ping failed.',
        isMock: false,
        endpointStatus: 'Ping Failed',
        authStatus: 'Unknown',
        lastSuccessfulRequest: 'None',
        lastError: err.message || 'Network error',
        responseTimeMs: 'N/A',
        isExternal: false
      });
    } finally {
      setIsTestingHealth(false);
    }
  };

  const handleDownloadSchema = () => {
    fetch('/supabase_schema.sql')
      .then((res) => res.text())
      .then((sql) => {
        const blob = new Blob([sql], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'supabase_schema.sql';
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => alert('Schema file ready at /supabase_schema.sql'));
  };

  const activeDiagnostics = healthTestResult || providerStatus;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">System & Workspace Settings</h1>
        <p className="text-xs text-gray-500 mt-1">
          Configure lead provider credentials, health status, Google Workspace authentication, and tenant database policies.
        </p>
      </div>

      {/* Provider Diagnostics Card */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-md border border-slate-800 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-base font-bold">Provider Diagnostics & Health</h2>
              <p className="text-xs text-slate-400">Live telemetry (API secrets & tokens remain strictly hidden)</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRunHealthCheck}
              disabled={isTestingHealth}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all shadow-xs cursor-pointer"
            >
              {isTestingHealth ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Testing Provider API...
                </>
              ) : (
                <>
                  <Activity className="w-3.5 h-3.5" /> Test Provider Connection
                </>
              )}
            </button>
          </div>
        </div>

        {/* 6 Required Diagnostic Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* 1. Provider Name */}
          <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <Server className="w-3 h-3 text-blue-400" /> Provider Name
            </p>
            <p className="text-sm font-bold text-white mt-1 truncate">{activeDiagnostics.providerName}</p>
          </div>

          {/* 2. Endpoint Status */}
          <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-purple-400" /> Endpoint Status
            </p>
            <p className="text-xs font-semibold text-slate-200 mt-1 truncate">{activeDiagnostics.endpointStatus || 'Configured'}</p>
          </div>

          {/* 3. Authentication Status */}
          <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <Lock className="w-3 h-3 text-emerald-400" /> Authentication Status
            </p>
            <p className="text-xs font-semibold text-slate-200 mt-1 truncate">{activeDiagnostics.authStatus || 'Missing API Key'}</p>
          </div>

          {/* 4. Last Successful Request */}
          <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <Clock className="w-3 h-3 text-emerald-400" /> Last Successful Request
            </p>
            <p className="text-xs font-bold text-emerald-400 mt-1 truncate">{activeDiagnostics.lastSuccessfulRequest || 'None yet'}</p>
          </div>

          {/* 5. Last Error */}
          <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-amber-400" /> Last Error
            </p>
            <p className={`text-xs font-bold mt-1 truncate ${activeDiagnostics.lastError !== 'None' ? 'text-amber-400' : 'text-slate-400'}`}>
              {activeDiagnostics.lastError || 'None'}
            </p>
          </div>

          {/* 6. Response Time */}
          <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <Activity className="w-3 h-3 text-blue-400" /> Response Time
            </p>
            <p className="text-xs font-bold text-blue-400 mt-1 truncate">{activeDiagnostics.responseTimeMs || 'N/A'}</p>
          </div>
        </div>

        <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700 text-xs text-slate-300 flex items-center justify-between">
          <span>Overall Status Message: <span className="font-bold text-white">{activeDiagnostics.message}</span></span>
          <span className="text-[10px] bg-slate-700 px-2 py-0.5 rounded text-slate-300 font-mono">Secrets Hidden</span>
        </div>
      </div>

      {/* Card 1: Lead Discovery Provider Abstraction */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-xs p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="text-base font-bold text-gray-900">Lead Discovery Data Provider</h2>
              <p className="text-xs text-gray-500">
                Select a provider for public LinkedIn search results.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-2">
            <label className="block max-w-md space-y-1.5">
              <span className="text-xs font-semibold text-gray-700">Active provider</span>
              <select
                value={providerType}
                onChange={event => {
                  const nextProvider = event.target.value as LeadProviderConfig['providerType'];
                  setProviderType(nextProvider);
                  onUpdateProviderConfig({ providerType: nextProvider });
                }}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="wikidata">Wikidata</option>
              </select>
            </label>

          <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider">
                    Server-configured provider credentials
                  </h3>
                  <p className="text-xs text-blue-800">
                    Wikidata does not require an API key and is automatically configured.
                  </p>
                </div>
              </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleRunHealthCheck}
              disabled={isTestingHealth}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-xs"
            >
              {isTestingHealth ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Testing Provider Connection...
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4" /> Run Live Provider Health Ping
                </>
              )}
            </button>
          </div>
        </div>
      </div>


      {/* Card 2: Google Workspace OAuth Integration */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-xs p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">Google Workspace & Sheets Integration</h2>
            <p className="text-xs text-gray-500">
              Required for exporting leads to Google Sheets and creating client spreadsheet files.
            </p>
          </div>

          <div>
            {isGoogleConnected ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                Not Connected
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-200">
          <div>
            <p className="text-xs font-bold text-gray-800">
              {currentUser?.email || userEmail ? `Signed in as ${currentUser?.email || userEmail}` : 'Google Account Unlinked'}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Authorized Scopes: <code className="text-blue-700 bg-blue-50 px-1 py-0.5 rounded">spreadsheets</code>, <code className="text-blue-700 bg-blue-50 px-1 py-0.5 rounded">drive.file</code>
            </p>
          </div>

          <button
            onClick={async () => {
              if (currentUser) {
                await googleSignOut();
              } else {
                const res = await googleSignIn();
                if (res) onGoogleAuthSuccess(res.user, res.accessToken);
              }
            }}
            className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-800 text-xs font-bold rounded-xl transition-colors shadow-xs"
          >
            {currentUser ? 'Disconnect Account' : 'Connect Google Account'}
          </button>
        </div>
      </div>

      {/* Card 3: Database & Supabase RLS Schema */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-xs p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">Supabase Connection Diagnostics</h2>
            <p className="text-xs text-gray-500">
              Multi-tenant database connection telemetry (Keys and secret tokens are strictly hidden).
            </p>
          </div>

          <button
            onClick={handleDownloadSchema}
            className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold px-3 py-2 rounded-xl border border-gray-300"
          >
            <FileCode className="w-4 h-4 text-blue-600" /> Export SQL Schema
          </button>
        </div>

        {/* 4 Required Supabase Diagnostics Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-xl border border-gray-200">
          <div>
            <span className="text-[10px] font-bold text-gray-500 uppercase block">Supabase URL</span>
            <span className={`text-xs font-bold mt-1 inline-block ${supabaseDiag?.supabaseUrlStatus === 'CONFIGURED' ? 'text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200' : 'text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200'}`}>
              {supabaseDiag?.supabaseUrlStatus || 'MISSING'}
            </span>
          </div>

          <div>
            <span className="text-[10px] font-bold text-gray-500 uppercase block">Supabase Client</span>
            <span className={`text-xs font-bold mt-1 inline-block ${supabaseDiag?.supabaseClientStatus === 'CONNECTED' ? 'text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200' : 'text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200'}`}>
              {supabaseDiag?.supabaseClientStatus || 'FAILED'}
            </span>
          </div>

          <div>
            <span className="text-[10px] font-bold text-gray-500 uppercase block">Database Query</span>
            <span className={`text-xs font-bold mt-1 inline-block ${supabaseDiag?.databaseQueryStatus === 'PASS' ? 'text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200' : 'text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200'}`}>
              {supabaseDiag?.databaseQueryStatus || 'FAIL'}
            </span>
          </div>

          <div>
            <span className="text-[10px] font-bold text-gray-500 uppercase block">Auth Service</span>
            <span className={`text-xs font-bold mt-1 inline-block ${supabaseDiag?.authServiceStatus === 'AVAILABLE' ? 'text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200' : 'text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200'}`}>
              {supabaseDiag?.authServiceStatus || 'FAILED'}
            </span>
          </div>
        </div>

        {supabaseDiag?.missingVariableNames && supabaseDiag.missingVariableNames.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-600" /> Missing Required Deployment Environment Variables:
            </p>
            <ul className="list-disc pl-5 font-mono text-[11px] text-amber-800 space-y-0.5">
              {supabaseDiag.missingVariableNames.map((v: string) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
          <span className="font-bold">Row Level Security (RLS):</span> Multi-tenant client isolation is active across all database operations. All clients and search records are partitioned by <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">workspace_id</code>.
        </div>
      </div>
    </div>
  );
};
