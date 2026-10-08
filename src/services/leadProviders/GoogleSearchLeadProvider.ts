import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';
import { normalizeLinkedInUrl } from '../deduplication';

/**
 * Google Custom Search / Programmable Search JSON API Adapter
 * Standard free-first API for searching public indexed LinkedIn profiles.
 * 
 * Documentation: https://developers.google.com/custom-search/v1/overview
 */
export class GoogleSearchLeadProvider implements LeadProvider {
  readonly providerId = 'google-search-provider';
  readonly providerName = 'Google Custom Search / Programmable Search';
  readonly isMock = false;

  private apiKey: string;
  private cx: string;

  constructor(apiKey?: string, cx?: string) {
    this.apiKey =
      apiKey ||
      process.env.GOOGLE_SEARCH_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY ||
      '';
    this.cx = cx || process.env.GOOGLE_SEARCH_ENGINE_ID || '41f25e8b9b4d94578';
  }

  /**
   * Generates targeted query combinations from user search filters
   */
  generateQueries(filters: LeadFilter): string[] {
    const titles = filters.jobTitles.length > 0 ? filters.jobTitles : ['Marketing Manager'];
    const country = filters.country || 'United States';
    const city = filters.city;
    const industries = filters.industry.length > 0 ? filters.industry : [];
    const seniorities = filters.seniority.length > 0 ? filters.seniority : [];

    const queries: string[] = [];

    for (const title of titles) {
      let queryStr = `site:linkedin.com/in/ "${title}" "${country}"`;
      
      if (city) {
        queryStr += ` "${city}"`;
      }
      if (industries.length > 0) {
        queryStr += ` "${industries[0]}"`;
      }
      if (seniorities.length > 0) {
        queryStr += ` "${seniorities[0]}"`;
      }

      queries.push(queryStr);
    }

    return queries;
  }

  /**
   * Extracts name, title, company, and location from Google Search result title & snippet
   */
  extractLeadRecord(item: any, filters: LeadFilter): RawLead | null {
    const rawLink = item.link || item.formattedUrl || '';
    
    // Accept ONLY URLs that clearly point to a LinkedIn public profile (/in/)
    if (!rawLink || !rawLink.toLowerCase().includes('linkedin.com/in/')) {
      return null;
    }

    const profileUrl = normalizeLinkedInUrl(rawLink);

    // Extract Title & Snippet
    const rawTitle = String(item.title || '').trim();
    const snippet = String(item.snippet || '').trim();

    // 1. Full Name Extraction from Google Title: "Jane Doe - Marketing Manager - Acme | LinkedIn"
    let fullName = '';
    const titleParts = rawTitle.split(/[-–|]/);
    if (titleParts.length > 0 && titleParts[0].trim().length >= 2) {
      fullName = titleParts[0].replace(/LinkedIn/i, '').trim();
    }

    if (!fullName || fullName.length < 2) {
      return null; // Do NOT invent names
    }

    // 2. Current Job Title Extraction
    let currentJobTitle = filters.jobTitles[0] || 'Executive';
    if (titleParts.length > 1) {
      currentJobTitle = titleParts[1].replace(/at/i, '').replace(/LinkedIn/i, '').trim() || currentJobTitle;
    }

    // 3. Company Name Extraction
    let companyName = 'Enterprise';
    if (titleParts.length > 2) {
      const candidateCompany = titleParts[2].replace(/LinkedIn/i, '').trim();
      if (candidateCompany && !candidateCompany.toLowerCase().includes('linkedin')) {
        companyName = candidateCompany;
      }
    }

    // 4. Location Extraction
    const location = filters.city ? `${filters.city}, ${filters.country}` : filters.country || 'United States';

    return {
      fullName,
      headline: snippet || `${currentJobTitle} at ${companyName} | ${location}`,
      currentJobTitle,
      companyName,
      location,
      profileUrl,
      connectionsOrFollowers: 'N/A', // Google Search does not provide reliable follower counts
      lastActivityDate: 'N/A', // Google Search does not provide reliable activity dates
      source: 'Google Custom Search API'
    };
  }

  async search(filters: LeadFilter): Promise<RawLead[]> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('Missing GOOGLE_SEARCH_API_KEY in environment variables.');
    }

    if (!this.cx || this.cx.trim() === '') {
      throw new Error('Missing GOOGLE_SEARCH_ENGINE_ID in environment variables.');
    }

    const targetLimit = Math.min(Math.max(filters.maxLeads || 50, 1), 500);
    const queries = this.generateQueries(filters);

    const candidates: RawLead[] = [];
    const seenUrls = new Set<string>();

    for (const query of queries) {
      if (candidates.length >= targetLimit) break;

      const numToFetch = Math.min(10, targetLimit - candidates.length);
      const params = new URLSearchParams({
        key: this.apiKey,
        cx: this.cx,
        q: query,
        num: String(numToFetch),
        start: '1'
      });

      const endpointUrl = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      try {
        const response = await fetch(endpointUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.status === 403) {
          const errData = await response.json().catch(() => ({}));
          const msg = errData.error?.message || '';
          if (msg.includes('does not have the access to Custom Search JSON API')) {
            throw new Error('Google Custom Search JSON API = UNAVAILABLE FOR NEW CUSTOMERS');
          }
          throw new Error(`Google API Error (403): ${msg || 'Access Denied'}`);
        }

        if (response.status === 429) {
          throw new Error('Google Custom Search API rate limit exceeded.');
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Google API returned HTTP ${response.status}`);
        }

        const data = await response.json();
        const items = data.items || [];

        for (const item of items) {
          const extracted = this.extractLeadRecord(item, filters);
          if (extracted && !seenUrls.has(extracted.profileUrl)) {
            seenUrls.add(extracted.profileUrl);
            candidates.push(extracted);
            if (candidates.length >= targetLimit) break;
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('Google Custom Search request timed out (12s limit).');
        }
        throw err;
      }
    }

    return candidates;
  }
}
