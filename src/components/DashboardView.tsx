import React, { useState } from 'react';
import { Client, LeadRecord, SearchHistoryRecord, ProviderStatusInfo } from '../types';
import {
  Users,
  Search,
  UserCheck,
  Calendar,
  ArrowRight,
  ShieldCheck,
  FileSpreadsheet,
  AlertCircle,
  XCircle,
  RefreshCw,
  Building2,
  ExternalLink,
  LogOut,
  User,
  PlusCircle,
  Database,
  CheckCircle2
} from 'lucide-react';
import { NavTab } from './Sidebar';

interface DashboardViewProps {
  clients: Client[];
  activeClient: Client | null;
  allLeads: LeadRecord[];
  allSearches: SearchHistoryRecord[];
  onNavigate: (tab: NavTab) => void;
  onOpenClient: (client: Client) => void;
  onSelectClient: (clientId: string) => void;
  onStartLeadSearch: () => void;
  providerStatus: ProviderStatusInfo;
  isGoogleConnected: boolean;
  isConnectingSheets?: boolean;
  sheetsAuthError?: string | null;
  onConnectSheets: () => void;
  onDisconnectSheets?: () => void;
  onOpenExportModal: (leads: LeadRecord[], clientName?: string) => void;
  userEmail: string;
  onSignOut: () => void;
  isLoadingData?: boolean;
  supabaseError?: string | null;
  onRetryData?: () => void;
  onRefreshProviderStatus?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  clients,
  activeClient,
  allLeads,
  allSearches,
  onNavigate,
  onOpenClient,
  onSelectClient,
  onStartLeadSearch,
  providerStatus,
  isGoogleConnected,
  isConnectingSheets = false,
  sheetsAuthError = null,
  onConnectSheets,
  onDisconnectSheets,
  onOpenExportModal,
  userEmail,
  onSignOut,
  isLoadingData = false,
  supabaseError = null,
  onRetryData,
  onRefreshProviderStatus
}) => {
  const [clientSelectionError, setClientSelectionError] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<'workspace' | 'client'>('workspace');

  // Filter leads based on selected scope
  const targetLeads =
    scopeMode === 'client' && activeClient
      ? allLeads.filter((l) => l.clientId === activeClient.id)
      : allLeads;

  const targetSearches =
    scopeMode === 'client' && activeClient
      ? allSearches.filter((s) => s.clientId === activeClient.id)
      : allSearches;

  // Real Stats Calculations
  const totalLeadsCount = targetLeads.length;
  const todayStr = new Date().toISOString().split('T')[0];
  const leadsTodayCount = targetLeads.filter((l) => l.dateAdded === todayStr).length;
  const activeClientsCount = clients.length;
  const searchesExecutedCount = targetSearches.length;

  const recentSearches = targetSearches.slice(0, 5);

  const handleStartSearchClick = () => {
    if (!activeClient) {
      setClientSelectionError('An active client is required before starting lead search. Please select or create a client below.');
      return;
    }
    setClientSelectionError(null);
    onStartLeadSearch();
  };

  const handleExportClick = () => {
    if (targetLeads.length === 0) {
      setClientSelectionError('No leads available to export. Discover leads first using the Lead Finder.');
      return;
    }
    onOpenExportModal(targetLeads, activeClient?.name);
  };

  return (
    <div className="space-y-6">
      {/* Supabase Error Alert if present */}
      {supabaseError && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between text-amber-900 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="font-semibold">Database Notice</p>
              <p className="text-xs text-amber-700">{supabaseError}</p>
            </div>
          </div>
          {onRetryData && (
            <button
              onClick={onRetryData}
              className="text-xs font-semibold px-3 py-1.5 bg-amber-100 hover:bg-amber-200 rounded-lg text-amber-900 transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          )}
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white p-6 rounded-2xl shadow-sm border border-slate-800">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center text-white font-bold text-xs">
              in
            </div>
            <h1 className="text-2xl font-bold tracking-tight">LinkedIn Lead Finder</h1>
            <span className="text-[10px] uppercase font-semibold bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">
              Agency Suite
            </span>
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">
            Discover real B2B leads via Serper.dev Google public web search, maintain strict client isolation, apply automated deduplication, and export directly to Google Sheets.
          </p>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleStartSearchClick}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all shadow-md shadow-blue-600/30 hover:scale-[1.01]"
          >
            <Search className="w-4 h-4" /> Start Lead Search
          </button>

          <button
            onClick={() => onNavigate('clients')}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium px-3.5 py-2.5 rounded-xl transition-all border border-slate-700"
          >
            <Users className="w-4 h-4" /> Manage Clients
          </button>
        </div>
      </div>

      {/* Validation Prompt if Client Not Selected */}
      {clientSelectionError && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-blue-900 text-sm">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
            <span>{clientSelectionError}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate('clients')}
              className="text-xs font-semibold px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              + Create Client
            </button>
            <button
              onClick={() => setClientSelectionError(null)}
              className="text-xs text-blue-700 hover:text-blue-900 font-medium px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Scope Selector Bar & Active Client Context Switcher */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Scope:
          </span>
          <div className="flex items-center bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setScopeMode('workspace')}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                scopeMode === 'workspace'
                  ? 'bg-white text-gray-900 shadow-xs font-semibold'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              All Clients ({clients.length})
            </button>
            <button
              onClick={() => {
                if (activeClient) setScopeMode('client');
                else setClientSelectionError('Please select a client first to view client-specific scope.');
              }}
              disabled={!activeClient}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all disabled:opacity-40 ${
                scopeMode === 'client' && activeClient
                  ? 'bg-white text-gray-900 shadow-xs font-semibold'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Active Client Only {activeClient ? `(${activeClient.name})` : ''}
            </button>
          </div>
        </div>

        {/* Action 4: Active Client Switcher Dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Active Client:</span>
          <div className="relative">
            <select
              value={activeClient ? activeClient.id : ''}
              onChange={(e) => {
                onSelectClient(e.target.value);
                setClientSelectionError(null);
              }}
              className="bg-gray-50 hover:bg-gray-100 border border-gray-300 text-gray-900 text-xs font-semibold rounded-xl px-3 py-2 pr-8 focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
            >
              <option value="" disabled>
                -- Select Active Client --
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.niche || 'B2B'})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => onNavigate('clients')}
            title="Create new client"
            className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Overview Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Stat 1: Total Leads */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Leads</p>
            {isLoadingData ? (
              <div className="h-8 w-16 bg-gray-200 animate-pulse rounded mt-1" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{totalLeadsCount}</h3>
            )}
            <p className="text-xs text-gray-500 mt-0.5">
              {scopeMode === 'client' && activeClient
                ? `Saved for ${activeClient.name}`
                : 'Across all client profiles'}
            </p>
          </div>
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
            <UserCheck className="w-6 h-6" />
          </div>
        </div>

        {/* Stat 2: Leads Today */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Leads Today</p>
            {isLoadingData ? (
              <div className="h-8 w-16 bg-gray-200 animate-pulse rounded mt-1" />
            ) : (
              <h3 className="text-2xl font-bold text-emerald-600 mt-1">{leadsTodayCount}</h3>
            )}
            <p className="text-xs text-gray-500 mt-0.5">Added in past 24 hours</p>
          </div>
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
            <Calendar className="w-6 h-6" />
          </div>
        </div>

        {/* Stat 3: Active Clients */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Clients</p>
            {isLoadingData ? (
              <div className="h-8 w-16 bg-gray-200 animate-pulse rounded mt-1" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{activeClientsCount}</h3>
            )}
            <p className="text-xs text-gray-500 mt-0.5">Isolated lead databases</p>
          </div>
          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Stat 4: Searches Executed */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Searches Executed</p>
            {isLoadingData ? (
              <div className="h-8 w-16 bg-gray-200 animate-pulse rounded mt-1" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{searchesExecutedCount}</h3>
            )}
            <p className="text-xs text-gray-500 mt-0.5">Audit log records</p>
          </div>
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
            <Search className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Integration & Provider Status Action Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Action 5: Provider Status Card */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-gray-900">Lead Provider Status</h3>
              </div>
              <div>
                {providerStatus.status === 'Connected' ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Connected
                  </span>
                ) : providerStatus.status === 'Not Configured' ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Not Configured
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                    <XCircle className="w-3.5 h-3.5 text-red-600" /> Error
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs font-semibold text-gray-800">{providerStatus.providerName}</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              {providerStatus.status === 'Connected'
                ? `${providerStatus.providerName} is active and ready to deliver verified leads.`
                : providerStatus.message || 'SERPER_API_KEY must be configured in Vercel environment variables.'}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
            <span className="text-gray-500">
              Response: <strong className="text-gray-700">{providerStatus.responseTimeMs || 'N/A'}</strong>
            </span>
            <button
              onClick={() => onNavigate('settings')}
              className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
            >
              Settings & Diagnostics <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Action 3: Google Sheets Integration Card */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-gray-900">Google Sheets Export</h3>
              </div>
              <div>
                {isGoogleConnected ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Disconnected
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs font-semibold text-gray-800">
              {isGoogleConnected ? 'Google Sheets Sync Ready' : 'Google OAuth Required'}
            </p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              {isGoogleConnected
                ? 'Your Google account is linked. Export any client lead table to live spreadsheets with deduplication.'
                : 'Connect your Google account to export discovered leads directly into new or existing spreadsheets.'}
            </p>
            {sheetsAuthError && (
              <p className="text-[11px] text-red-600 mt-1 font-medium">
                {sheetsAuthError}
              </p>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
            {isGoogleConnected ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportClick}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Export {targetLeads.length} Leads
                  </button>
                  {onDisconnectSheets && (
                    <button
                      onClick={onDisconnectSheets}
                      className="text-gray-400 hover:text-red-600 text-[11px] px-2 py-1 rounded transition-colors"
                      title="Disconnect Google Sheets"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
                <span className="text-[11px] text-gray-500 truncate max-w-[150px]">
                  {userEmail}
                </span>
              </>
            ) : (
              <button
                onClick={onConnectSheets}
                disabled={isConnectingSheets}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> {isConnectingSheets ? 'Connecting...' : 'Connect Sheets'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Active Client Spotlight Card & Action 2: View Leads & Sheet */}
      {activeClient ? (
        <div className="bg-white p-6 rounded-2xl border border-gray-200/80 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
            <div>
              <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">
                Active Client Context
              </span>
              <h2 className="text-xl font-bold text-gray-900 mt-0.5">{activeClient.name}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Target Niche: <span className="font-semibold text-gray-700">{activeClient.niche || 'General B2B'}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onOpenClient(activeClient)}
                className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors border border-blue-200"
              >
                View Leads & Sheet <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleStartSearchClick}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors shadow-xs"
              >
                <Search className="w-3.5 h-3.5" /> Search Leads for {activeClient.name}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xs font-medium text-gray-500">Client Leads Collected</p>
              <p className="text-lg font-bold text-gray-900 mt-1">
                {allLeads.filter((l) => l.clientId === activeClient.id).length} leads
              </p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xs font-medium text-gray-500">Searches Performed</p>
              <p className="text-lg font-bold text-gray-900 mt-1">
                {allSearches.filter((s) => s.clientId === activeClient.id).length} searches
              </p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xs font-medium text-gray-500">Notes / Scope</p>
              <p className="text-xs text-gray-700 mt-1 line-clamp-2">
                {activeClient.notes || 'No specific notes recorded.'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-6 rounded-2xl border border-gray-200/80 shadow-xs text-center py-8">
          <div className="w-12 h-12 bg-gray-100 text-gray-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-gray-900">No Active Client Selected</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto mt-1">
            Select an existing client from the dropdown above or create a new client to begin discovering leads.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => onNavigate('clients')}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-xs"
            >
              + Create Client
            </button>
          </div>
        </div>
      )}

      {/* Action 6: Account Profile & Working Logout Card */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center font-bold text-sm">
            <User className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-900">{userEmail}</span>
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                Workspace Owner
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Production access authenticated with full agency workspace permissions.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-3.5 py-2 rounded-xl transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </div>

      {/* Recent Searches Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Recent Lead Searches</h2>
            <p className="text-xs text-gray-500">Latest manual filter queries and discovery counts</p>
          </div>
          <button
            onClick={() => onNavigate('history')}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            View Full History <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentSearches.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            <p className="font-medium text-gray-700">No searches executed yet.</p>
            <p className="text-xs text-gray-500 mt-1">
              Select a client and click{' '}
              <button onClick={handleStartSearchClick} className="text-blue-600 font-semibold underline">
                Start Lead Search
              </button>{' '}
              to launch your first search.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 border-b border-gray-100 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Job Titles</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4 text-center">Candidates</th>
                  <th className="py-3 px-4 text-center">Dupes Removed</th>
                  <th className="py-3 px-4 text-center">Final Unique</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                {recentSearches.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-gray-900">{s.clientName}</td>
                    <td className="py-3 px-4 text-gray-500">
                      {new Date(s.searchDate).toLocaleDateString()}{' '}
                      {new Date(s.searchDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-4 max-w-[200px] truncate">
                      {s.filters?.jobTitles?.join(', ') || 'N/A'}
                    </td>
                    <td className="py-3 px-4">{s.filters?.country || 'N/A'}</td>
                    <td className="py-3 px-4 text-center text-gray-500">{s.candidatesFound}</td>
                    <td className="py-3 px-4 text-center text-amber-600 font-medium">-{s.duplicatesRemoved}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-bold">
                        {s.finalLeadCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
