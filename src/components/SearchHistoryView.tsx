import React, { useState } from 'react';
import { SearchHistoryRecord, LeadRecord } from '../types';
import { History, Search, ArrowRight, X, Calendar, User, Filter, FileText } from 'lucide-react';
import { LeadsTableView } from './LeadsTableView';

interface SearchHistoryViewProps {
  searches: SearchHistoryRecord[];
  getLeadsForSearch?: (searchId: string) => LeadRecord[];
}

export const SearchHistoryView: React.FC<SearchHistoryViewProps> = ({
  searches,
  getLeadsForSearch
}) => {
  const [selectedSearch, setSelectedSearch] = useState<SearchHistoryRecord | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Lead Search History</h1>
        <p className="text-xs text-gray-500 mt-1">
          Review all executed search queries, deduplication counts, and audit logs. Re-open previous search sessions.
        </p>
      </div>

      {searches.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center text-gray-500">
          <History className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-semibold">No search history recorded yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            Searches run through the Lead Finder will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200/90 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Filters Used</th>
                  <th className="py-3 px-4 text-center">Candidates</th>
                  <th className="py-3 px-4 text-center">Valid Leads</th>
                  <th className="py-3 px-4 text-center">Dupes Removed</th>
                  <th className="py-3 px-4 text-center">Final Count</th>
                  <th className="py-3 px-4">Run By User</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                {searches.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/70 transition-colors">
                    <td className="py-3 px-4 font-bold text-gray-900">{s.clientName}</td>
                    <td className="py-3 px-4 text-gray-500">
                      {new Date(s.searchDate).toLocaleDateString()} {new Date(s.searchDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-4 max-w-[240px]">
                      <div className="space-y-1">
                        <div className="font-semibold text-gray-800 truncate">
                          Titles: {s.filters.jobTitles.join(', ')}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">
                          Loc: {s.filters.country} | Sen: {s.filters.seniority.join(', ') || 'Any'}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-semibold text-gray-600">{s.candidatesFound}</td>
                    <td className="py-3 px-4 text-center text-gray-700">{s.validLeads}</td>
                    <td className="py-3 px-4 text-center text-amber-600 font-bold">-{s.duplicatesRemoved}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-bold text-xs">
                        {s.finalLeadCount}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-500 text-[11px]">{s.createdBy}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedSearch(s)}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg text-xs font-semibold"
                      >
                        Re-open <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Re-open Search Detail Modal */}
      {selectedSearch && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <span className="text-[10px] font-bold text-blue-600 uppercase">Search Audit Record</span>
                <h3 className="text-lg font-bold text-gray-900 mt-0.5">
                  Search Session for {selectedSearch.clientName}
                </h3>
              </div>
              <button onClick={() => setSelectedSearch(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs">
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-semibold">Search Date</p>
                <p className="font-bold text-gray-800">{new Date(selectedSearch.searchDate).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-semibold">Candidates</p>
                <p className="font-bold text-gray-800">{selectedSearch.candidatesFound}</p>
              </div>
              <div>
                <p className="text-[10px] text-amber-700 uppercase font-semibold">Dupes Removed</p>
                <p className="font-bold text-amber-600">-{selectedSearch.duplicatesRemoved}</p>
              </div>
              <div>
                <p className="text-[10px] text-emerald-700 uppercase font-semibold">Final Unique</p>
                <p className="font-bold text-emerald-700">{selectedSearch.finalLeadCount}</p>
              </div>
            </div>

            <div className="space-y-2 text-xs bg-slate-900 text-slate-200 p-4 rounded-xl">
              <p className="font-bold text-white flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-blue-400" /> Applied Search Filters
              </p>
              <div className="grid grid-cols-2 gap-2 text-slate-300 pt-1">
                <div><span className="text-slate-400 font-semibold">Titles:</span> {selectedSearch.filters.jobTitles.join(', ')}</div>
                <div><span className="text-slate-400 font-semibold">Industry:</span> {selectedSearch.filters.industry.join(', ') || 'Any'}</div>
                <div><span className="text-slate-400 font-semibold">Location:</span> {selectedSearch.filters.country} {selectedSearch.filters.city ? `(${selectedSearch.filters.city})` : ''}</div>
                <div><span className="text-slate-400 font-semibold">Seniority:</span> {selectedSearch.filters.seniority.join(', ') || 'Any'}</div>
                <div><span className="text-slate-400 font-semibold">Company Size:</span> {selectedSearch.filters.companySize.join(', ') || 'Any'}</div>
                <div><span className="text-slate-400 font-semibold">Max Requested:</span> {selectedSearch.filters.maxLeads}</div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedSearch(null)}
                className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl"
              >
                Close Audit View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
