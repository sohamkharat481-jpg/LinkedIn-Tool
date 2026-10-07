import { DeduplicationResult, RawLead } from '../types';

/**
 * Normalizes a LinkedIn profile URL by:
 * - Lowercasing protocol and hostname
 * - Stripping query parameters (e.g. ?utm_source=... or ?miniProfileUrn=...)
 * - Stripping trailing slashes
 * - Standardizing http:// to https://
 * - Ensuring standard domain structure (e.g., https://linkedin.com/in/username)
 */
export function normalizeLinkedInUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  
  let trimmed = url.trim().toLowerCase();
  
  // Ensure http/https prefix
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = 'https://' + trimmed;
  }
  
  try {
    const parsed = new URL(trimmed);
    // Standardize hostname
    let hostname = parsed.hostname.replace(/^www\./, '');
    if (!hostname.includes('linkedin.com')) {
      return trimmed;
    }
    
    let pathname = parsed.pathname.replace(/\/+$/, ''); // Remove trailing slashes
    return `https://${hostname}${pathname}`;
  } catch {
    // Basic fallback regex normalization if URL parsing fails
    return trimmed.split('?')[0].replace(/\/+$/, '');
  }
}

/**
 * Generates a deduplication composite key for a person based on:
 * Normalized Full Name + Normalized Company Name + Normalized Profile URL
 */
export function generatePersonCompositeKey(lead: RawLead): string {
  const normName = (lead.fullName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normCompany = (lead.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normUrl = normalizeLinkedInUrl(lead.profileUrl);
  return `${normName}_${normCompany}_${normUrl}`;
}

/**
 * Validates required fields:
 * - Full Name must not be empty or blank
 * - Current Job Title must not be empty
 * - Company Name must not be empty
 * - Profile URL must be present and contain "linkedin.com"
 */
export function isValidLeadRecord(lead: RawLead): boolean {
  if (!lead) return false;
  
  const hasName = Boolean(lead.fullName && lead.fullName.trim().length >= 2);
  const hasJobTitle = Boolean(lead.currentJobTitle && lead.currentJobTitle.trim().length >= 2);
  const hasCompany = Boolean(lead.companyName && lead.companyName.trim().length >= 1);
  const hasUrl = Boolean(lead.profileUrl && lead.profileUrl.trim().toLowerCase().includes('linkedin.com'));

  return hasName && hasJobTitle && hasCompany && hasUrl;
}

/**
 * Executes the complete 6-step lead filtering & deduplication process.
 */
export function filterAndDeduplicateLeads(candidates: RawLead[]): DeduplicationResult {
  const rawCandidatesCount = candidates.length;

  // Step 1 & 2: Validate required fields and remove invalid records
  const validRecords = candidates.filter(isValidLeadRecord);
  const validRecordsCount = validRecords.length;

  // Step 3 & 4: Normalize LinkedIn profile URLs and remove duplicate profile URLs
  const uniqueUrlLeadsMap = new Map<string, RawLead>();
  let duplicateProfilesRemoved = 0;

  for (const rawLead of validRecords) {
    const normalizedUrl = normalizeLinkedInUrl(rawLead.profileUrl);
    const normalizedLead = {
      ...rawLead,
      profileUrl: normalizedUrl
    };

    if (uniqueUrlLeadsMap.has(normalizedUrl)) {
      duplicateProfilesRemoved++;
    } else {
      uniqueUrlLeadsMap.set(normalizedUrl, normalizedLead);
    }
  }

  const leadsAfterUrlDedupe = Array.from(uniqueUrlLeadsMap.values());

  // Step 5: Remove duplicate people using composite key (name + company + profile URL)
  const uniquePeopleMap = new Map<string, RawLead>();
  let duplicatePeopleRemoved = 0;

  for (const lead of leadsAfterUrlDedupe) {
    const compositeKey = generatePersonCompositeKey(lead);
    if (uniquePeopleMap.has(compositeKey)) {
      duplicatePeopleRemoved++;
    } else {
      uniquePeopleMap.set(compositeKey, lead);
    }
  }

  // Step 6: Return final unique leads
  const finalUniqueLeads = Array.from(uniquePeopleMap.values());
  const totalDuplicatesRemoved = duplicateProfilesRemoved + duplicatePeopleRemoved;

  return {
    rawCandidatesCount,
    validRecordsCount,
    duplicateProfilesRemoved,
    duplicatePeopleRemoved,
    totalDuplicatesRemoved,
    finalUniqueLeads
  };
}
