import React, { useState, useMemo } from 'react';
import { LeadRecord, LeadStatus } from '../types';
import {
  ExternalLink,
  Search,
  FileSpreadsheet,
  Trash2,
  Edit3,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  ArrowUpDown
} from 'lucide-react';

interface LeadsTableViewProps {
  leads: LeadRecord[];
  clientName?: string;
  onUpdateStatus: (leadId: string, status: LeadStatus) => void;
  onUpdateNotes: (leadId: string, notes: string) => void;
  onDeleteLeads: (leadIds: string[]) => void;
  onExportToSheets: (selectedLeads: LeadRecord[]) => void;
  isGoogleConnected: boolean;
}

const STATUS_OPTIONS: { label: LeadStatus; color: string; bgColor: string }[] = [
  { label: 'Not Contacted', color: 'text-gray-700', bgColor: 'bg-gray-100 border-gray-200' },
  { label: 'Request Sent', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200' },
  { label: 'Accepted', color: 'text-purple-700', bgColor: 'bg-purple-50 border-purple-200' },
  { label: 'Replied', color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-200' },
  { label: 'Call Booked', color: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-200' }
];

export const LeadsTableView: React.FC<LeadsTableViewProps> = ({
  leads,
  clientName,
  onUpdateStatus,
  onUpdateNotes,
  onDeleteLeads,
  onExportToSheets,
  isGoogleConnected
}) => {
  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Filtering & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'dateAdded' | 'fullName' | 'companyName' | 'status'>('dateAdded');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Note editing modal/inline state
  const [editingNoteLead, setEditingNoteLead] = useState<LeadRecord | null>(null);
  const [noteInputValue, setNoteInputValue] = useState('');

  // Filtered & Sorted Leads
  const processedLeads = useMemo(() => {
    return leads
      .filter((lead) => {
        const matchesQuery =
          !searchQuery ||
          lead.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          lead.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          lead.currentJobTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
          lead.headline.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesStatus = statusFilter === 'ALL' || lead.status === statusFilter;

        return matchesQuery && matchesStatus;
      })
      .sort((a, b) => {
        let valA = a[sortBy] || '';
        let valB = b[sortBy] || '';
        if (sortOrder === 'asc') {
          return valA.localeCompare(valB);
        } else {
          return valB.localeCompare(valA);
        }
      });
  }, [leads, searchQuery, statusFilter, sortBy, sortOrder]);

  // Paginated Slice
  const totalPages = Math.max(1, Math.ceil(processedLeads.length / pageSize));
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedLeads.slice(start, start + pageSize);
  }, [processedLeads, currentPage, pageSize]);

  // Selection Logic
  const isAllSelected =
    paginatedLeads.length > 0 && paginatedLeads.every((l) => selectedIds.includes(l.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      const pageIds = new Set(paginatedLeads.map((l) => l.id));
      setSelectedIds(selectedIds.filter((id) => !pageIds.has(id)));
    } else {
      const pageIds = paginatedLeads.map((l) => l.id);
      const combined = new Set([...selectedIds, ...pageIds]);
      setSelectedIds(Array.from(combined));
    }
  };

  const handleToggleSelectRow = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleExportSelected = () => {
    const selectedLeadsList = leads.filter((l) => selectedIds.includes(l.id));
    onExportToSheets(selectedLeadsList.length > 0 ? selectedLeadsList : leads);
  };

  const handleOpenNoteModal = (lead: LeadRecord) => {
    setEditingNoteLead(lead);
    setNoteInputValue(lead.notes || '');
  };

  const handleSaveNote = () => {
    if (editingNoteLead) {
      onUpdateNotes(editingNoteLead.id, noteInputValue.trim());
      setEditingNoteLead(null);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length > 0) {
      if (window.confirm(`Delete ${selectedIds.length} selected lead(s)?`)) {
        onDeleteLeads(selectedIds);
        setSelectedIds([]);
      }
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200/90 shadow-xs overflow-hidden space-y-4">
      {/* Table Toolbar */}
      <div className="p-4 bg-gray-50/80 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
        
        {/* Search & Filter Inputs */}
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by name, company, title..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full text-xs pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs font-medium bg-white border border-gray-300 rounded-xl px-3 py-2 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.label}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Sort By */}
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-') as [any, any];
              setSortBy(field);
              setSortOrder(order);
            }}
            className="text-xs font-medium bg-white border border-gray-300 rounded-xl px-3 py-2 focus:outline-none cursor-pointer"
          >
            <option value="dateAdded-desc">Newest Added</option>
            <option value="dateAdded-asc">Oldest Added</option>
            <option value="fullName-asc">Name (A-Z)</option>
            <option value="companyName-asc">Company (A-Z)</option>
            <option value="status-asc">Status</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold px-3 py-2 rounded-xl transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete ({selectedIds.length})
            </button>
          )}

          <button
            onClick={handleExportSelected}
            disabled={leads.length === 0}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all shadow-xs"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>
              Export to Google Sheets
              {selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </span>
          </button>
        </div>
      </div>

      {/* Main Table */}
      {processedLeads.length === 0 ? (
        <div className="p-12 text-center text-gray-500 text-sm">
          No leads found matching your filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-3 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4 min-w-[150px]">Full Name</th>
                <th className="py-3 px-4 min-w-[200px]">Headline</th>
                <th className="py-3 px-4 min-w-[140px]">Current Job Title</th>
                <th className="py-3 px-4 min-w-[130px]">Company</th>
                <th className="py-3 px-4 min-w-[120px]">Location</th>
                <th className="py-3 px-4 min-w-[100px] text-center">LinkedIn Profile</th>
                <th className="py-3 px-4 min-w-[110px]">Connections</th>
                <th className="py-3 px-4 min-w-[100px]">Last Activity</th>
                <th className="py-3 px-4 min-w-[90px]">Date Added</th>
                <th className="py-3 px-4 min-w-[130px]">Status</th>
                <th className="py-3 px-4 min-w-[120px]">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
              {paginatedLeads.map((lead) => {
                const isSelected = selectedIds.includes(lead.id);
                const currentStatusOpt =
                  STATUS_OPTIONS.find((s) => s.label === lead.status) || STATUS_OPTIONS[0];

                return (
                  <tr
                    key={lead.id}
                    className={`hover:bg-blue-50/40 transition-colors ${
                      isSelected ? 'bg-blue-50/60' : ''
                    }`}
                  >
                    <td className="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelectRow(lead.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-3 px-4 font-bold text-gray-900">{lead.fullName}</td>
                    <td className="py-3 px-4 text-gray-600 line-clamp-2 max-w-[240px]" title={lead.headline}>
                      {lead.headline}
                    </td>
                    <td className="py-3 px-4 text-gray-800 font-semibold">{lead.currentJobTitle}</td>
                    <td className="py-3 px-4 font-semibold text-gray-900">{lead.companyName}</td>
                    <td className="py-3 px-4 text-gray-600">{lead.location}</td>
                    <td className="py-3 px-4 text-center">
                      <a
                        href={lead.profileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold hover:underline bg-blue-50 px-2 py-1 rounded-md border border-blue-200 text-[11px]"
                      >
                        Profile <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                    <td className="py-3 px-4 text-gray-600">{lead.connectionsOrFollowers}</td>
                    <td className="py-3 px-4 text-gray-600">{lead.lastActivityDate}</td>
                    <td className="py-3 px-4 text-gray-500">{lead.dateAdded}</td>
                    <td className="py-3 px-4">
                      {/* Manual Status Dropdown */}
                      <select
                        value={lead.status}
                        onChange={(e) => onUpdateStatus(lead.id, e.target.value as LeadStatus)}
                        className={`text-[11px] font-bold border rounded-lg px-2 py-1 focus:outline-none cursor-pointer ${currentStatusOpt.bgColor} ${currentStatusOpt.color}`}
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt.label} value={opt.label}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleOpenNoteModal(lead)}
                        className="text-left w-full text-gray-600 hover:text-blue-600 group flex items-center gap-1"
                      >
                        <span className="truncate max-w-[100px] text-xs">
                          {lead.notes || <span className="text-gray-400 italic">+ Add note</span>}
                        </span>
                        <Edit3 className="w-3 h-3 text-gray-400 group-hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      <div className="p-4 bg-gray-50/80 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-gray-600">
        <div>
          Showing <span className="font-semibold text-gray-900">{Math.min(processedLeads.length, (currentPage - 1) * pageSize + 1)}</span> to{' '}
          <span className="font-semibold text-gray-900">{Math.min(processedLeads.length, currentPage * pageSize)}</span> of{' '}
          <span className="font-semibold text-gray-900">{processedLeads.length}</span> leads
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span>Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-white border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-semibold">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Edit Notes Modal */}
      {editingNoteLead && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-sm w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h4 className="text-sm font-bold text-gray-900">
                Notes for {editingNoteLead.fullName}
              </h4>
              <button onClick={() => setEditingNoteLead(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              rows={4}
              value={noteInputValue}
              onChange={(e) => setNoteInputValue(e.target.value)}
              placeholder="Enter internal notes, follow-up reminders, or call details..."
              className="w-full text-xs border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingNoteLead(null)}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNote}
                className="px-3.5 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
