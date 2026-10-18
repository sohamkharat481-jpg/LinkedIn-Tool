import React, { useState, useMemo } from 'react';
import { LeadRecord, LeadStatus, B2BLeadClassification, EntityPeriod } from '../types';
import {
  ExternalLink,
  Search,
  FileSpreadsheet,
  Trash2,
  Edit3,
  ChevronLeft,
  ChevronRight,
  Filter,
  Info,
  ShieldCheck,
  CheckCircle2,
  X,
  AlertTriangle,
  Globe,
  Award
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
  const [classificationFilter, setClassificationFilter] = useState<string>('ALL');
  const [periodFilter, setPeriodFilter] = useState<string>('ALL'); // 'ALL' | 'MODERN_ACTIVE' | 'EXCLUDE_DECEASED' | 'HISTORICAL_DECEASED'
  const [sortBy, setSortBy] = useState<'dateAdded' | 'fullName' | 'companyName' | 'status' | 'relevanceScore'>('dateAdded');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Note editing modal state
  const [editingNoteLead, setEditingNoteLead] = useState<LeadRecord | null>(null);
  const [noteInputValue, setNoteInputValue] = useState('');

  // Transparency / Relevance Breakdown Modal state
  const [explainingLead, setExplainingLead] = useState<LeadRecord | null>(null);

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

        const matchesClassification =
          classificationFilter === 'ALL' ||
          (lead.b2bClassification || 'Discovered') === classificationFilter;

        let matchesPeriod = true;
        if (periodFilter === 'MODERN_ACTIVE') {
          matchesPeriod = !lead.isDeceased && lead.entityPeriod !== 'historical';
        } else if (periodFilter === 'EXCLUDE_DECEASED') {
          matchesPeriod = !lead.isDeceased;
        } else if (periodFilter === 'HISTORICAL_DECEASED') {
          matchesPeriod = Boolean(lead.isDeceased || lead.entityPeriod === 'historical');
        }

        return matchesQuery && matchesStatus && matchesClassification && matchesPeriod;
      })
      .sort((a, b) => {
        if (sortBy === 'relevanceScore') {
          const scoreA = a.relevanceScore ?? 50;
          const scoreB = b.relevanceScore ?? 50;
          return sortOrder === 'asc' ? scoreA - scoreB : scoreB - scoreA;
        }

        let valA = a[sortBy] || '';
        let valB = b[sortBy] || '';
        if (sortOrder === 'asc') {
          return valA.localeCompare(valB);
        } else {
          return valB.localeCompare(valA);
        }
      });
  }, [leads, searchQuery, statusFilter, classificationFilter, periodFilter, sortBy, sortOrder]);

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

  const getClassificationBadge = (classification?: B2BLeadClassification) => {
    switch (classification) {
      case 'Qualified Prospect':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          label: 'Qualified Prospect'
        };
      case 'Contact Available':
        return {
          bg: 'bg-blue-50 text-blue-800 border-blue-200',
          label: 'Contact Available'
        };
      case 'Relevant':
        return {
          bg: 'bg-purple-50 text-purple-800 border-purple-200',
          label: 'Relevant'
        };
      default:
        return {
          bg: 'bg-gray-100 text-gray-700 border-gray-200',
          label: 'Discovered'
        };
    }
  };

  const getScoreColor = (score?: number) => {
    if (score === undefined) return 'text-gray-600 bg-gray-50 border-gray-200';
    if (score >= 70) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (score >= 45) return 'text-blue-700 bg-blue-50 border-blue-200';
    if (score >= 30) return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-rose-700 bg-rose-50 border-rose-200';
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

          {/* B2B Classification Filter */}
          <select
            value={classificationFilter}
            onChange={(e) => {
              setClassificationFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs font-medium bg-white border border-gray-300 rounded-xl px-3 py-2 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All B2B Classifications</option>
            <option value="Qualified Prospect">Qualified Prospect</option>
            <option value="Contact Available">Contact Available</option>
            <option value="Relevant">Relevant</option>
            <option value="Discovered">Discovered</option>
          </select>

          {/* Historical / Life Status Filter */}
          <select
            value={periodFilter}
            onChange={(e) => {
              setPeriodFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs font-medium bg-white border border-gray-300 rounded-xl px-3 py-2 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Life & Era Records</option>
            <option value="MODERN_ACTIVE">Modern & Potentially Active</option>
            <option value="EXCLUDE_DECEASED">Exclude Deceased</option>
            <option value="HISTORICAL_DECEASED">Historical / Deceased Only</option>
          </select>

          {/* Outreach Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs font-medium bg-white border border-gray-300 rounded-xl px-3 py-2 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Outreach Statuses</option>
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
            <option value="relevanceScore-desc">Relevance (High to Low)</option>
            <option value="relevanceScore-asc">Relevance (Low to High)</option>
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
        <div className="p-12 text-center text-gray-500 text-sm space-y-1">
          <p className="font-semibold text-gray-700">No leads found matching your filters.</p>
          <p className="text-xs text-gray-400">Try adjusting your B2B classification, life status, or search query.</p>
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
                <th className="py-3 px-4 min-w-[170px]">Name & Status</th>
                <th className="py-3 px-4 min-w-[130px]">Relevance Score</th>
                <th className="py-3 px-4 min-w-[140px]">B2B Classification</th>
                <th className="py-3 px-4 min-w-[140px]">Category / Title</th>
                <th className="py-3 px-4 min-w-[200px]">Headline / Description</th>
                <th className="py-3 px-4 min-w-[140px]">Company</th>
                <th className="py-3 px-4 min-w-[120px]">Location</th>
                <th className="py-3 px-4 min-w-[160px]">Official Website</th>
                <th className="py-3 px-4 min-w-[150px]">Public Business Email</th>
                <th className="py-3 px-4 min-w-[130px]">Business Phone</th>
                <th className="py-3 px-4 min-w-[120px]">Contact Status</th>
                <th className="py-3 px-4 min-w-[100px] text-center">Source Link</th>
                <th className="py-3 px-4 min-w-[130px]">Outreach Status</th>
                <th className="py-3 px-4 min-w-[120px]">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
              {paginatedLeads.map((lead) => {
                const isSelected = selectedIds.includes(lead.id);
                const currentStatusOpt =
                  STATUS_OPTIONS.find((s) => s.label === lead.status) || STATUS_OPTIONS[0];
                const classBadge = getClassificationBadge(lead.b2bClassification);
                const scoreBadgeClass = getScoreColor(lead.relevanceScore);

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

                    {/* Name & Historical / Deceased Badge */}
                    <td className="py-3 px-4">
                      <div className="space-y-1">
                        <span className="font-bold text-gray-900 block">{lead.fullName}</span>
                        {lead.isDeceased ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                            Deceased {lead.dateOfDeath ? `(${lead.dateOfDeath})` : ''}
                          </span>
                        ) : lead.entityPeriod === 'historical' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                            Historical Entity
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                            Modern / Living
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Relevance Score & Breakdown Button */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-bold px-2 py-0.5 rounded-md border text-[11px] ${scoreBadgeClass}`}
                        >
                          {lead.relevanceScore !== undefined ? `${lead.relevanceScore}%` : '50%'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setExplainingLead(lead)}
                          title="View transparent score breakdown"
                          className="text-gray-400 hover:text-blue-600 p-0.5 rounded hover:bg-gray-100 transition-colors"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* B2B Classification */}
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold ${classBadge.bg}`}
                      >
                        {classBadge.label}
                      </span>
                    </td>

                    {/* Category / Title */}
                    <td className="py-3 px-4 text-gray-800 font-semibold">{lead.currentJobTitle}</td>

                    {/* Headline */}
                    <td className="py-3 px-4 text-gray-600 line-clamp-2 max-w-[240px]" title={lead.headline}>
                      {lead.headline}
                    </td>

                    {/* Company */}
                    <td className="py-3 px-4 font-semibold text-gray-900">{lead.companyName}</td>

                    {/* Location */}
                    <td className="py-3 px-4 text-gray-600">{lead.location}</td>

                    {/* Official Website */}
                    <td className="py-3 px-4 text-gray-600">
                      {lead.businessWebsite && /^https?:\/\//i.test(lead.businessWebsite) ? (
                        <a
                          href={lead.businessWebsite}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline flex items-center gap-1 max-w-[150px] truncate"
                          title={lead.businessWebsite}
                        >
                          <Globe className="w-3 h-3 shrink-0" />
                          <span className="truncate">{lead.businessWebsite.replace(/^https?:\/\/(www\.)?/, '')}</span>
                        </a>
                      ) : (
                        <span className="text-gray-400 italic">None on record</span>
                      )}
                    </td>

                    {/* Public Business Email */}
                    <td className="py-3 px-4 text-gray-600">
                      {lead.businessEmail ? (
                        <a
                          href={`mailto:${lead.businessEmail}`}
                          className="text-blue-600 hover:underline truncate block max-w-[140px]"
                          title={lead.businessEmail}
                        >
                          {lead.businessEmail}
                        </a>
                      ) : (
                        <span className="text-gray-400 italic">Not listed</span>
                      )}
                    </td>

                    {/* Business Phone */}
                    <td className="py-3 px-4 text-gray-600">
                      {lead.businessPhone ? (
                        <span className="font-semibold text-gray-800">{lead.businessPhone}</span>
                      ) : (
                        <span className="text-gray-400 italic">Not listed</span>
                      )}
                    </td>

                    {/* Contact Verification Status */}
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
                        lead.contactVerificationStatus === 'Available'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                      }`}>
                        {lead.contactVerificationStatus || (lead.businessWebsite || lead.businessEmail || lead.businessPhone ? 'Available' : 'Not listed')}
                      </span>
                    </td>

                    {/* Wikidata Source Link */}
                    <td className="py-3 px-4 text-center">
                      <a
                        href={lead.profileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold hover:underline bg-blue-50 px-2 py-1 rounded-md border border-blue-200 text-[11px]"
                      >
                        Wikidata <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>

                    {/* Manual Status Dropdown */}
                    <td className="py-3 px-4">
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

                    {/* Notes */}
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
          Showing{' '}
          <span className="font-semibold text-gray-900">
            {processedLeads.length === 0 ? 0 : Math.min(processedLeads.length, (currentPage - 1) * pageSize + 1)}
          </span>{' '}
          to{' '}
          <span className="font-semibold text-gray-900">
            {Math.min(processedLeads.length, currentPage * pageSize)}
          </span>{' '}
          of <span className="font-semibold text-gray-900">{processedLeads.length}</span> leads
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

      {/* Transparent Relevance Explanation Modal */}
      {explainingLead && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h4 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  Evidence-Based Relevance Breakdown
                </h4>
                <p className="text-xs text-gray-500 mt-0.5">
                  Entity: <span className="font-semibold text-gray-800">{explainingLead.fullName}</span>
                </p>
              </div>
              <button
                onClick={() => setExplainingLead(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Score & Classification Header */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-500 block">Overall Relevance</span>
                <span className="text-lg font-extrabold text-blue-700">
                  {explainingLead.relevanceScore !== undefined ? `${explainingLead.relevanceScore} / 100` : '50 / 100'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-500 block">Status Classification</span>
                <span className="text-xs font-bold text-gray-900 block mt-1">
                  {explainingLead.b2bClassification || 'Discovered'}
                </span>
              </div>
            </div>

            {/* Detailed Criteria Breakdown */}
            <div className="space-y-2 text-xs">
              <h5 className="font-bold text-gray-800 uppercase text-[11px] tracking-wider">Scoring Breakdown</h5>
              
              <div className="space-y-1.5 bg-gray-50 p-3 rounded-xl border border-gray-200">
                {explainingLead.relevanceBreakdown?.details && explainingLead.relevanceBreakdown.details.length > 0 ? (
                  explainingLead.relevanceBreakdown.details.map((detail, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-gray-700">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                      <span>{detail}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-600">
                    {explainingLead.relevanceExplanation || 'Transparent scoring based on documented occupation, niche alignment, website presence, and activity evidence.'}
                  </p>
                )}
              </div>
            </div>

            {/* Historical & Life Status Info */}
            <div className="text-xs bg-amber-50/60 p-3 rounded-xl border border-amber-200/80 space-y-1 text-amber-900">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Historical & Contact Integrity Guarantee
              </div>
              <p className="text-[11px] text-amber-800">
                {explainingLead.isDeceased
                  ? `This person is documented as deceased on Wikidata${explainingLead.dateOfDeath ? ` (${explainingLead.dateOfDeath})` : ''}. They are retained for transparency but cannot be classified as a qualified prospect.`
                  : 'Public entity data retrieved directly from Wikidata Query Service. Missing data is never treated as negative proof. Emails, phone numbers, and active status are never fabricated.'}
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setExplainingLead(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
