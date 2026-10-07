import React, { useState } from 'react';
import { Client, LeadFilter, SeniorityLevel, CompanySizeRange, RawLead, SearchProgressState, ProviderStatusInfo } from '../types';
import { Search, Sparkles, Filter, CheckCircle2, Loader2, AlertTriangle, ArrowRight, ShieldCheck, Tag, XCircle, Settings } from 'lucide-react';

interface LeadFinderViewProps {
  clients: Client[];
  activeClient: Client | null;
  onSelectClient: (clientId: string) => void;
  onExecuteSearch: (filters: LeadFilter, targetClient: Client) => Promise<{
    uniqueLeads: RawLead[];
    candidatesFound: number;
    duplicatesRemoved: number;
    finalCount: number;
  }>;
  onNavigateToLeads: () => void;
  onNavigateToSettings: () => void;
  providerStatus: ProviderStatusInfo;
  onEnableMockMode: () => void;
}

const SENIORITY_OPTIONS: SeniorityLevel[] = ['Entry', 'Manager', 'Senior', 'Director', 'VP', 'C-Level'];

const COMPANY_SIZE_OPTIONS: CompanySizeRange[] = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001+'];

const POPULAR_COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'India',
  'Germany',
  'France',
  'Singapore',
  'United Arab Emirates',
  'Brazil'
];

const POPULAR_JOB_TITLE_PRESETS = [
  'Founder',
  'CEO',
  'Marketing Manager',
  'VP of Sales',
  'Chief Medical Officer',
  'Director of Operations',
  'CTO',
  'Managing Director',
  'Clinical Director'
];

const POPULAR_INDUSTRY_PRESETS = [
  'Healthcare',
  'Technology & SaaS',
  'Hospitals & Medical Practice',
  'Financial Services',
  'Real Estate',
  'Marketing & Advertising',
  'Management Consulting'
];

export const LeadFinderView: React.FC<LeadFinderViewProps> = ({
  clients,
  activeClient,
  onSelectClient,
  onExecuteSearch,
  onNavigateToLeads,
  onNavigateToSettings,
  providerStatus,
  onEnableMockMode
}) => {
  // Form State
  const [jobTitles, setJobTitles] = useState<string[]>(['Founder', 'CEO', 'Marketing Manager']);
  const [titleInput, setTitleInput] = useState('');
  
  const [industries, setIndustries] = useState<string[]>(['Technology & SaaS']);
  const [industryInput, setIndustryInput] = useState('');

  const [country, setCountry] = useState('United States');
  const [city, setCity] = useState('');

  const [seniority, setSeniority] = useState<SeniorityLevel[]>(['Director', 'VP', 'C-Level']);
  const [companySize, setCompanySize] = useState<CompanySizeRange[]>(['11-50', '51-200']);

  const [maxLeads, setMaxLeads] = useState<number>(50);

  // Execution & Progress State
  const [isSearching, setIsSearching] = useState(false);
  const [progressState, setProgressState] = useState<SearchProgressState | null>(null);
  const [searchResultSummary, setSearchResultSummary] = useState<{
    candidatesFound: number;
    duplicatesRemoved: number;
    finalCount: number;
  } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Tag helper functions
  const handleAddJobTitle = (titleToAdd: string) => {
    const trimmed = titleToAdd.trim();
    if (trimmed && !jobTitles.includes(trimmed)) {
      setJobTitles([...jobTitles, trimmed]);
      setTitleInput('');
    }
  };

  const handleRemoveJobTitle = (titleToRemove: string) => {
    setJobTitles(jobTitles.filter((t) => t !== titleToRemove));
  };

  const handleAddIndustry = (indToAdd: string) => {
    const trimmed = indToAdd.trim();
    if (trimmed && !industries.includes(trimmed)) {
      setIndustries([...industries, trimmed]);
      setIndustryInput('');
    }
  };

  const handleRemoveIndustry = (indToRemove: string) => {
    setIndustries(industries.filter((i) => i !== indToRemove));
  };

  const toggleSeniority = (level: SeniorityLevel) => {
    if (seniority.includes(level)) {
      setSeniority(seniority.filter((s) => s !== level));
    } else {
      setSeniority([...seniority, level]);
    }
  };

  const toggleCompanySize = (size: CompanySizeRange) => {
    if (companySize.includes(size)) {
      setCompanySize(companySize.filter((c) => c !== size));
    } else {
      setCompanySize([...companySize, size]);
    }
  };

  const handleRunSearch = async () => {
    if (!activeClient) {
      setSearchError('Please select or create an active target client first.');
      return;
    }

    if (jobTitles.length === 0) {
      setSearchError('At least one job title is required.');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setSearchResultSummary(null);

    const filters: LeadFilter = {
      jobTitles,
      industry: industries,
      country,
      city: city.trim() || undefined,
      seniority,
      companySize,
      maxLeads: Math.min(maxLeads, 50)
    };

    try {
      // Step 1: Preparing search...
      setProgressState({ step: 1, message: 'Preparing search parameters...' });
      await new Promise((r) => setTimeout(r, 300));

      // Step 2: Finding potential leads...
      setProgressState({ step: 2, message: 'Connecting to server lead provider...' });
      
      // Execute backend API search
      const result = await onExecuteSearch(filters, activeClient);

      // Step 3: Filtering results...
      setProgressState({ step: 3, message: 'Validating public lead records...' });
      await new Promise((r) => setTimeout(r, 300));

      // Step 4: Removing duplicates...
      setProgressState({ step: 4, message: 'Executing profile URL & composite deduplication...' });
      await new Promise((r) => setTimeout(r, 300));

      // Step 5: Preparing results...
      setProgressState({ step: 5, message: 'Saving unique leads to client database...' });
      await new Promise((r) => setTimeout(r, 200));

      setSearchResultSummary({
        candidatesFound: result.candidatesFound,
        duplicatesRemoved: result.duplicatesRemoved,
        finalCount: result.finalCount
      });
    } catch (err: any) {
      setSearchError(err.message || 'An error occurred while finding leads.');
    } finally {
      setIsSearching(false);
      setProgressState(null);
    }
  };

  const isNotConfigured = !providerStatus.isMock && providerStatus.status === 'Not Configured';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Find Potential Customers</h1>
          <p className="text-xs text-gray-500 mt-1">
            Configure manual search filters to discover relevant public B2B leads.
          </p>
        </div>

        {/* Active Client Selection Card */}
        <div className="bg-blue-50 border border-blue-200 p-3 rounded-2xl flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">
              Target Client
            </span>
            <select
              value={activeClient ? activeClient.id : ''}
              onChange={(e) => onSelectClient(e.target.value)}
              className="bg-transparent text-xs font-bold text-blue-900 focus:outline-none cursor-pointer"
            >
              <option value="" disabled>-- Select Client --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.niche})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Mandatory Empty State Banner when No Provider Configured */}
      {isNotConfigured && (
        <div className="p-6 bg-amber-50/90 border-2 border-amber-300 rounded-2xl space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-base font-bold text-amber-900">
                No real lead provider is configured.
              </h3>
              <p className="text-xs text-amber-800">
                To perform production searches, set <code className="bg-amber-100 font-mono px-1 py-0.5 rounded text-amber-900 font-bold">LEAD_PROVIDER_API_KEY</code> in environment variables or enter your key in Settings. Alternatively, enable Demo / Mock Mode to test searching with sample leads.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onEnableMockMode}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-xs"
            >
              <Sparkles className="w-4 h-4" /> Switch to Demo / Mock Mode
            </button>
            <button
              onClick={onNavigateToSettings}
              className="flex items-center gap-1.5 bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-xs"
            >
              <Settings className="w-4 h-4 text-amber-700" /> Configure API Key in Settings
            </button>
          </div>
        </div>
      )}

      {!activeClient && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-800 text-xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <span>
            Please select a target client above before running a lead search so all discovered leads remain isolated to that client.
          </span>
        </div>
      )}

      {/* Main Search Configuration Card */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-xs p-6 space-y-6">
        
        {/* Section 1: Job Titles & Industry */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Job Titles */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Job Titles * (Multiple Allowed)
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="Type job title & press Enter..."
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddJobTitle(titleInput);
                  }
                }}
                className="flex-1 text-xs border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => handleAddJobTitle(titleInput)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-3 py-2 rounded-xl"
              >
                Add
              </button>
            </div>

            {/* Selected Tags */}
            <div className="flex flex-wrap gap-1.5 min-h-[36px]">
              {jobTitles.map((title) => (
                <span
                  key={title}
                  className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-800 border border-blue-200 text-xs font-semibold px-2.5 py-1 rounded-lg"
                >
                  {title}
                  <button
                    type="button"
                    onClick={() => handleRemoveJobTitle(title)}
                    className="text-blue-500 hover:text-blue-900 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            {/* Presets */}
            <div className="mt-2 text-[11px] text-gray-500 flex flex-wrap items-center gap-1">
              <span className="font-medium text-gray-400">Presets:</span>
              {POPULAR_JOB_TITLE_PRESETS.slice(0, 5).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleAddJobTitle(preset)}
                  className="text-blue-600 hover:underline bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200"
                >
                  +{preset}
                </button>
              ))}
            </div>
          </div>

          {/* Industry */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Industry (Multiple Allowed)
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="Type industry & press Enter..."
                value={industryInput}
                onChange={(e) => setIndustryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddIndustry(industryInput);
                  }
                }}
                className="flex-1 text-xs border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => handleAddIndustry(industryInput)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-3 py-2 rounded-xl"
              >
                Add
              </button>
            </div>

            {/* Selected Industries */}
            <div className="flex flex-wrap gap-1.5 min-h-[36px]">
              {industries.map((ind) => (
                <span
                  key={ind}
                  className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-800 border border-purple-200 text-xs font-semibold px-2.5 py-1 rounded-lg"
                >
                  {ind}
                  <button
                    type="button"
                    onClick={() => handleRemoveIndustry(ind)}
                    className="text-purple-500 hover:text-purple-900 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            {/* Presets */}
            <div className="mt-2 text-[11px] text-gray-500 flex flex-wrap items-center gap-1">
              <span className="font-medium text-gray-400">Presets:</span>
              {POPULAR_INDUSTRY_PRESETS.slice(0, 4).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleAddIndustry(preset)}
                  className="text-purple-600 hover:underline bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200"
                >
                  +{preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section 2: Country & City */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Country *
            </label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full text-xs font-medium border border-gray-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              {POPULAR_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              City (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. New York, Chicago, London, Toronto"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Section 3: Seniority & Company Size */}
        <div className="space-y-4 pt-4 border-t border-gray-100">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Seniority Level
            </label>
            <div className="flex flex-wrap gap-2">
              {SENIORITY_OPTIONS.map((level) => {
                const isSelected = seniority.includes(level);
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => toggleSeniority(level)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Company Size (Employees)
            </label>
            <div className="flex flex-wrap gap-2">
              {COMPANY_SIZE_OPTIONS.map((size) => {
                const isSelected = companySize.includes(size);
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => toggleCompanySize(size)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {size}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 4: Max Leads Limit */}
        <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              Maximum Leads to Discover (Phase 1 Max = 50)
            </label>
            <p className="text-xs text-gray-500">Default = 50 unique leads per search run</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="10"
              max="50"
              step="5"
              value={maxLeads}
              onChange={(e) => setMaxLeads(parseInt(e.target.value, 10))}
              className="w-32 accent-blue-600 cursor-pointer"
            />
            <span className="text-sm font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded-lg border border-gray-200 min-w-[50px] text-center">
              {maxLeads}
            </span>
          </div>
        </div>

        {/* Filter Summary Before Starting */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
          <div className="font-bold text-slate-800 flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-blue-600" /> Filter Summary Overview
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-slate-600">
            <div><span className="font-semibold text-slate-900">Client:</span> {activeClient?.name || 'None'}</div>
            <div><span className="font-semibold text-slate-900">Titles:</span> {jobTitles.join(', ') || 'Any'}</div>
            <div><span className="font-semibold text-slate-900">Location:</span> {city ? `${city}, ${country}` : country}</div>
            <div><span className="font-semibold text-slate-900">Seniority:</span> {seniority.join(', ') || 'Any'}</div>
          </div>
        </div>

        {searchError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-medium flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Search Execution Error</p>
              <p className="mt-0.5">{searchError}</p>
            </div>
          </div>
        )}

        {/* Find Leads Action Button */}
        <div className="pt-2">
          <button
            onClick={handleRunSearch}
            disabled={isSearching || !activeClient || isNotConfigured}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm py-3.5 px-6 rounded-2xl transition-all shadow-md shadow-blue-600/20"
          >
            {isSearching ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Searching & Deduplicating...</span>
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                <span>Find Leads</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Real Progress Modal Overlay */}
      {isSearching && progressState && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-md w-full p-6 text-center space-y-4">
            <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900">{progressState.message}</h3>
              <p className="text-xs text-gray-500 mt-1">Executing server-side validation & deduplication pipeline</p>
            </div>

            {/* Step Progress Tracker */}
            <div className="space-y-2 text-left pt-2">
              {[
                'Preparing search parameters...',
                'Connecting to server lead provider...',
                'Validating public lead records...',
                'Executing profile URL & composite deduplication...',
                'Saving unique leads to client database...'
              ].map((msg, idx) => {
                const stepNum = idx + 1;
                const isCompleted = progressState.step > stepNum;
                const isCurrent = progressState.step === stepNum;

                return (
                  <div key={msg} className="flex items-center gap-3 text-xs">
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : isCurrent ? (
                      <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-gray-300 shrink-0" />
                    )}
                    <span className={isCompleted ? 'text-gray-900 font-semibold' : isCurrent ? 'text-blue-600 font-bold' : 'text-gray-400'}>
                      {msg}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Completion Summary Card */}
      {searchResultSummary && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />
            <div>
              <h3 className="text-lg font-bold text-emerald-900">
                Search completed — {searchResultSummary.finalCount} unique leads found.
              </h3>
              <p className="text-xs text-emerald-700 mt-0.5">
                Saved directly to client database for <span className="font-bold">{activeClient?.name}</span>.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center bg-white/80 p-3 rounded-xl border border-emerald-100">
            <div>
              <p className="text-[10px] text-gray-500 font-semibold uppercase">Candidates Discovered</p>
              <p className="text-base font-bold text-gray-900">{searchResultSummary.candidatesFound}</p>
            </div>
            <div>
              <p className="text-[10px] text-amber-700 font-semibold uppercase">Duplicates Removed</p>
              <p className="text-base font-bold text-amber-600">-{searchResultSummary.duplicatesRemoved}</p>
            </div>
            <div>
              <p className="text-[10px] text-emerald-700 font-semibold uppercase">Final Unique Leads</p>
              <p className="text-base font-bold text-emerald-700">{searchResultSummary.finalCount}</p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={onNavigateToLeads}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-xs"
            >
              View Discovered Leads <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
