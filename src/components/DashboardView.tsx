import React from 'react';
import { Client, LeadRecord, SearchHistoryRecord } from '../types';
import { Users, Search, UserCheck, Calendar, ArrowRight, ShieldCheck, FileSpreadsheet } from 'lucide-react';
import { NavTab } from './Sidebar';

interface DashboardViewProps {
  clients: Client[];
  activeClient: Client | null;
  allLeads: LeadRecord[];
  allSearches: SearchHistoryRecord[];
  onNavigate: (tab: NavTab) => void;
  onOpenClient: (client: Client) => void;
  providerIsMock: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  clients,
  activeClient,
  allLeads,
  allSearches,
  onNavigate,
  onOpenClient,
  providerIsMock
}) => {
  // Stats calculation
  const totalLeadsCount = allLeads.length;

  const todayStr = new Date().toISOString().split('T')[0];
  const leadsTodayCount = allLeads.filter((l) => l.dateAdded === todayStr).length;

  const activeClientsCount = clients.length;
  const recentSearchesCount = allSearches.length;

  const recentSearches = allSearches.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white p-6 rounded-2xl shadow-sm border border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">LinkedIn Lead Finder</h1>
            {providerIsMock && (
              <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-md">
                Demo Mode
              </span>
            )}
          </div>
          <p className="text-slate-300 text-sm max-w-xl">
            Discover, deduplicate, and manage high-intent B2B leads for your agency clients. Export directly to Google Sheets with automated duplicate prevention.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('finder')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all shadow-md shadow-blue-600/30"
          >
            <Search className="w-4 h-4" /> Start Lead Search
          </button>
        </div>
      </div>

      {/* Overview Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Stat 1: Total Leads */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Leads</p>
            <h3 className="text-2xl font-bold text-gray-900 mt-1">{totalLeadsCount}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Collected across all clients</p>
          </div>
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
            <UserCheck className="w-6 h-6" />
          </div>
        </div>

        {/* Stat 2: Leads Today */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Leads Today</p>
            <h3 className="text-2xl font-bold text-emerald-600 mt-1">{leadsTodayCount}</h3>
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
            <h3 className="text-2xl font-bold text-gray-900 mt-1">{activeClientsCount}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Isolated lead profiles</p>
          </div>
          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Stat 4: Recent Searches */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Searches Executed</p>
            <h3 className="text-2xl font-bold text-gray-900 mt-1">{recentSearchesCount}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Search filter histories</p>
          </div>
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
            <Search className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Active Client Spotlight Card */}
      {activeClient && (
        <div className="bg-white p-6 rounded-2xl border border-gray-200/80 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
            <div>
              <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">
                Active Client Context
              </span>
              <h2 className="text-xl font-bold text-gray-900 mt-0.5">{activeClient.name}</h2>
              <p className="text-xs text-gray-500 mt-0.5">Niche: <span className="font-semibold text-gray-700">{activeClient.niche}</span></p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenClient(activeClient)}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold px-3 py-2 rounded-xl transition-colors"
              >
                View Leads & Sheet <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xs font-medium text-gray-500">Client Leads Collected</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{activeClient.leadsCount || 0} leads</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xs font-medium text-gray-500">Searches Performed</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{activeClient.searchesCount || 0} searches</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xs font-medium text-gray-500">Notes / Scope</p>
              <p className="text-xs text-gray-700 mt-1 line-clamp-2">{activeClient.notes || 'No notes provided.'}</p>
            </div>
          </div>
        </div>
      )}

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
            No recent searches. Click <button onClick={() => onNavigate('finder')} className="text-blue-600 font-semibold underline">Find Leads</button> to launch your first search.
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
                      {new Date(s.searchDate).toLocaleDateString()} {new Date(s.searchDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-4 max-w-[200px] truncate">
                      {s.filters.jobTitles.join(', ')}
                    </td>
                    <td className="py-3 px-4">{s.filters.country}</td>
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
