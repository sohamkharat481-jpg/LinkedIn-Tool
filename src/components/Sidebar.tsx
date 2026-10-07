import React from 'react';
import { Search, Users, History, Settings, ShieldCheck, Sparkles, Database, AlertCircle, XCircle } from 'lucide-react';
import { Client, ProviderStatusInfo } from '../types';

export type NavTab = 'finder' | 'clients' | 'history' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeClient: Client | null;
  providerStatus: ProviderStatusInfo;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  activeClient,
  providerStatus
}) => {
  const navItems = [
    { id: 'finder' as NavTab, label: 'Lead Finder', icon: Search },
    { id: 'clients' as NavTab, label: 'Clients', icon: Users },
    { id: 'history' as NavTab, label: 'Lead History', icon: History },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings }
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 border-r border-slate-800 min-h-screen">
      {/* Brand & App Title */}
      <div className="p-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-blue-500/20 font-bold text-lg">
          in
        </div>
        <div>
          <h1 className="text-base font-bold text-white tracking-tight">LinkedIn Lead Finder</h1>
          <p className="text-[11px] text-slate-400 font-medium">B2B Public Lead Discovery</p>
        </div>
      </div>

      {/* Active Client Notice */}
      {activeClient && (
        <div className="mx-4 mt-4 p-3 bg-slate-800/80 rounded-xl border border-slate-700/60">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Current Target Client
          </div>
          <div className="font-semibold text-sm text-blue-400 truncate">{activeClient.name}</div>
          <div className="text-xs text-slate-400 truncate">{activeClient.niche}</div>
        </div>
      )}

      {/* Navigation Menu */}
      <nav className="flex-1 p-4 space-y-1.5">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Navigation
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all text-left ${
                isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Provider Status Indicator Card */}
      <div className="p-4 m-4 bg-slate-800/50 rounded-xl border border-slate-800">
        <div className="flex items-center gap-2 mb-1.5">
          <Database className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-semibold text-slate-200">Lead Provider</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {providerStatus.isMock ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Sparkles className="w-3 h-3" /> Demo / Mock Mode
            </span>
          ) : providerStatus.status === 'Connected' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-3 h-3" /> Connected
            </span>
          ) : providerStatus.status === 'Not Configured' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertCircle className="w-3 h-3" /> Not Configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
              <XCircle className="w-3 h-3" /> Error
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-400 mt-2 line-clamp-2">
          {providerStatus.message}
        </p>
      </div>

      {/* Footer info */}
      <div className="p-4 border-t border-slate-800 text-[11px] text-slate-500 text-center">
        Phase 1 • Manual Lead Discovery
      </div>
    </aside>
  );
};
