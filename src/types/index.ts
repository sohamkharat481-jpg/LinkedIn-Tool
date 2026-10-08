/**
 * Core type definitions for LinkedIn Lead Finder
 */

export type SeniorityLevel = 'Entry' | 'Manager' | 'Senior' | 'Director' | 'VP' | 'C-Level';

export type CompanySizeRange = '1-10' | '11-50' | '51-200' | '201-500' | '501-1000' | '1001+';

export type LeadStatus = 'Not Contacted' | 'Request Sent' | 'Accepted' | 'Replied' | 'Call Booked';

export interface LeadFilter {
  jobTitles: string[];
  industry: string[];
  country: string;
  city?: string;
  seniority: SeniorityLevel[];
  companySize: CompanySizeRange[];
  maxLeads: number;
}

export interface RawLead {
  fullName: string;
  headline: string;
  currentJobTitle: string;
  companyName: string;
  location: string;
  profileUrl: string;
  connectionsOrFollowers?: string;
  lastActivityDate?: string;
  source?: string;
}

export interface LeadRecord {
  id: string;
  workspaceId: string;
  clientId: string;
  searchId?: string;
  fullName: string;
  headline: string;
  currentJobTitle: string;
  companyName: string;
  location: string;
  profileUrl: string;
  connectionsOrFollowers: string;
  lastActivityDate: string;
  dateAdded: string;
  status: LeadStatus;
  notes: string;
  source: string;
}

export interface Client {
  id: string;
  workspaceId: string;
  name: string;
  niche: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  leadsCount?: number;
  searchesCount?: number;
}

export interface SearchHistoryRecord {
  id: string;
  workspaceId: string;
  clientId: string;
  clientName: string;
  searchDate: string;
  filters: LeadFilter;
  candidatesFound: number;
  validLeads: number;
  duplicatesRemoved: number;
  finalLeadCount: number;
  createdBy: string;
  leads?: LeadRecord[];
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
}

export interface GoogleIntegration {
  id: string;
  workspaceId: string;
  clientId: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetTitle: string;
  lastExportedAt: string;
}

export interface ExportHistoryRecord {
  id: string;
  workspaceId: string;
  clientId: string;
  spreadsheetId: string;
  exportedLeadsCount: number;
  skippedDuplicatesCount: number;
  exportedByEmail: string;
  createdAt: string;
}

export interface SearchProgressState {
  step: number; // 1 to 5
  message: string;
  candidatesFound?: number;
  validLeads?: number;
  duplicatesRemoved?: number;
  finalLeadCount?: number;
}

export interface LeadProviderConfig {
  providerType: 'mock' | 'rapidapi' | 'custom_proxy' | 'google_search';
  apiKey?: string;
  customEndpoint?: string;
}

export interface DeduplicationResult {
  rawCandidatesCount: number;
  validRecordsCount: number;
  duplicateProfilesRemoved: number;
  duplicatePeopleRemoved: number;
  totalDuplicatesRemoved: number;
  finalUniqueLeads: RawLead[];
}

export interface GoogleSheetExportResult {
  success: boolean;
  spreadsheetId: string;
  spreadsheetUrl: string;
  addedCount: number;
  skippedDuplicatesCount: number;
  message: string;
}

export interface ProviderStatusInfo {
  configured: boolean;
  providerName: string;
  status: 'Connected' | 'Not Configured' | 'Error';
  message: string;
  isMock: boolean;
  endpointStatus: string;
  authStatus: string;
  lastSuccessfulRequest: string;
  lastError: string;
  responseTimeMs: string | number;
  isExternal: boolean;
  diagnostics?: {
    apiKeyDetected?: boolean;
    searchEngineIdDetected?: boolean;
    providerInitialized?: boolean;
    apiEnabled?: string;
    credentialsValid?: string;
    apiRestrictionIssue?: string;
    quotaBillingIssue?: string;
    searchEngineValid?: string;
    httpStatusCode?: number;
    googleErrorMessage?: string;
  };
}
