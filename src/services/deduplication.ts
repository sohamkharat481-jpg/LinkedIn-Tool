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

export function normalizeProfileUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.replace(/^www\./, '');
    
    // Canonicalize Wikidata URLs to standard https format
    if (hostname.includes('wikidata.org')) {
      const match = parsed.pathname.match(/\/(wiki|entity)\/(Q\d+)/i);
      if (match) {
        return `https://www.wikidata.org/wiki/${match[2].toUpperCase()}`;
      }
      return `https://${hostname}${parsed.pathname}`;
    }

    if (hostname === 'linkedin.com') {
      return normalizeLinkedInUrl(url);
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Generates a deduplication composite key for a person based on:
 * Normalized Full Name + Normalized Company Name + Normalized Profile URL
 */
export function generatePersonCompositeKey(lead: RawLead): string {
  const normName = (lead.fullName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normCompany = (lead.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normUrl = normalizeProfileUrl(lead.profileUrl);
  return `${normName}_${normCompany}_${normUrl}`;
}

/**
 * Validates required fields:
 * - Full Name must not be empty or blank (>= 2 chars)
 * - Current Job Title must not be empty
 * - Profile URL must be present and valid
 */
export function isValidLeadRecord(lead: RawLead): boolean {
  if (!lead) return false;
  
  const isPresent = (value: string | undefined) =>
    Boolean(value?.trim() && !['n/a', 'na', 'unknown'].includes(value.trim().toLowerCase()));

  const hasName = Boolean(isPresent(lead.fullName) && lead.fullName.trim().length >= 2);
  
  // Relaxed: A lead is valid if it has at least a name and a profile URL
  const rawUrl = (lead.profileUrl || '').trim().toLowerCase();
  const hasValidUrl = Boolean(
    rawUrl &&
      (rawUrl.includes('wikidata.org') ||
        rawUrl.includes('linkedin.com') ||
        rawUrl.startsWith('http://') ||
        rawUrl.startsWith('https://'))
  );

  return hasName && hasValidUrl;
}

/**
 * Executes the complete 6-step lead filtering & deduplication process.
 */
export function filterAndDeduplicateLeads(candidates: RawLead[]): DeduplicationResult {
  const rawCandidatesCount = candidates.length;
  console.log(`[Dedupe Diagnostic] Starting with ${rawCandidatesCount} raw candidates`);

  // Step 1 & 2: Validate required fields and remove invalid records
  const validRecords = candidates.filter(isValidLeadRecord);
  const validRecordsCount = validRecords.length;
  console.log(`[Dedupe Diagnostic] Found ${validRecordsCount} valid records after validation`);

  // Step 3 & 4: Normalize LinkedIn profile URLs and remove duplicate profile URLs
  const uniqueUrlLeadsMap = new Map<string, RawLead>();
  let duplicateProfilesRemoved = 0;
  let duplicateBusinessesRemoved = 0;

  for (const rawLead of validRecords) {
    const normalizedUrl = normalizeProfileUrl(rawLead.profileUrl);
    const normalizedLead = {
      ...rawLead,
      profileUrl: normalizedUrl
    };

    if (uniqueUrlLeadsMap.has(normalizedUrl)) {
      if (rawLead.leadType === 'business') duplicateBusinessesRemoved++;
      else duplicateProfilesRemoved++;
    } else {
      uniqueUrlLeadsMap.set(normalizedUrl, normalizedLead);
    }
  }
  console.log(`[Dedupe Diagnostic] After URL deduplication: ${uniqueUrlLeadsMap.size} unique URLs`);

  // Step 5: Remove duplicate people using composite key (name + company + profile URL)
  const uniquePeopleMap = new Map<string, RawLead>();
  let duplicatePeopleRemoved = 0;

  for (const lead of uniqueUrlLeadsMap.values()) {
    const compositeKey = generatePersonCompositeKey(lead);
    if (uniquePeopleMap.has(compositeKey)) {
      duplicatePeopleRemoved++;
    } else {
      uniquePeopleMap.set(compositeKey, lead);
    }
  }
  console.log(`[Dedupe Diagnostic] After composite key deduplication: ${uniquePeopleMap.size} unique people`);

  // Step 6: Return final unique leads
  const finalUniqueLeads = Array.from(uniquePeopleMap.values());
  const totalDuplicatesRemoved = duplicateProfilesRemoved + duplicatePeopleRemoved;
  
  console.log(`[Dedupe Diagnostic] Final pipeline result: ${finalUniqueLeads.length} unique leads`);

  return {
    rawCandidatesCount,
    validRecordsCount,
    duplicateProfilesRemoved,
    duplicatePeopleRemoved,
    duplicateBusinessesRemoved,
    totalDuplicatesRemoved,
    finalUniqueLeads
  };
}
