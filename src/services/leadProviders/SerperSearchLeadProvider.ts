import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';
import { normalizeLinkedInUrl } from '../deduplication';

/**
 * SerperSearchLeadProvider
 * 
 * Uses the official Serper.dev Google Search API (https://google.serper.dev/search)
 * to discover publicly indexed LinkedIn member profiles without scraping LinkedIn
 * or automating LinkedIn accounts.
 */
export class SerperSearchLeadProvider implements LeadProvider {
  readonly providerId = 'serper-search-provider';
  readonly providerName = 'Serper.dev Google Search API';
  readonly isMock = false;

  private apiKey: string;
  private endpoint: string;

  constructor(apiKey?: string, endpoint?: string) {
    this.apiKey =
      apiKey ||
      process.env.SERPER_API_KEY ||
      process.env.SERPER_SEARCH_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY ||
      '';
    this.endpoint = endpoint || 'https://google.serper.dev/search';
  }

  /**
   * Generates targeted Google dork query combinations based on user filters.
   * e.g. site:linkedin.com/in/ "CEO" "SaaS" "United States"
   */
  generateQueries(filters: LeadFilter): string[] {
    const titles = filters.jobTitles && filters.jobTitles.length > 0 ? filters.jobTitles : ['CEO', 'Founder'];
    const country = filters.country || 'United States';
    const city = filters.city;
    const industries = filters.industry && filters.industry.length > 0 ? filters.industry : [];
    const seniorities = filters.seniority && filters.seniority.length > 0 ? filters.seniority : [];
    const keywords = filters.keywords ? filters.keywords.trim() : '';

    const queries: string[] = [];

    for (const title of titles) {
      let q = `site:linkedin.com/in/ "${title}" "${country}"`;

      if (city) {
        q += ` "${city}"`;
      }
      if (industries.length > 0) {
        q += ` "${industries[0]}"`;
      }
      if (seniorities.length > 0 && !title.toLowerCase().includes(seniorities[0].toLowerCase())) {
        q += ` "${seniorities[0]}"`;
      }
      if (keywords) {
        q += ` ${keywords}`;
      }

      queries.push(q);
    }

    return queries;
  }

  /**
   * Extracts clean, genuine Lead record from Serper organic search item.
   * Discards non-profile links or malformed snippets.
   */
  extractLeadRecord(item: any, filters: LeadFilter): RawLead | null {
    const rawLink = item.link || item.formattedUrl || '';

    // Strictly validate that link is a LinkedIn individual profile
    if (!rawLink || !rawLink.toLowerCase().includes('linkedin.com/in/')) {
      return null;
    }

    const profileUrl = normalizeLinkedInUrl(rawLink);

    // Title format from Google index: "Jane Doe - Founder & CEO - TechNova | LinkedIn"
    const rawTitle = String(item.title || '').trim();
    const snippet = String(item.snippet || '').trim();

    // 1. Full Name Extraction
    const titleParts = rawTitle.split(/[-–|•]/).map((p) => p.trim());
    let fullName = '';
    if (titleParts.length > 0 && titleParts[0].length >= 2) {
      fullName = titleParts[0].replace(/LinkedIn/i, '').trim();
    }

    // Never accept fabricated or empty names
    if (!fullName || fullName.length < 2 || fullName.toLowerCase().includes('linkedin')) {
      return null;
    }

    // 2. Job Title & Company Extraction
    let jobTitle = filters.jobTitles[0] || 'Executive';
    let company = 'Enterprise';

    if (titleParts.length > 1) {
      let candidate = titleParts[1].replace(/LinkedIn/i, '').trim();
      if (candidate.toLowerCase().includes(' at ')) {
        const atSplit = candidate.split(/ at /i);
        candidate = atSplit[0].trim();
        if (atSplit[1] && atSplit[1].trim().length >= 2) {
          company = atSplit[1].replace(/LinkedIn/i, '').trim();
        }
      }
      if (candidate.length >= 2) {
        jobTitle = candidate;
      }
    }

    // 3. Fallback Company Extraction from subsequent title parts
    if (company === 'Enterprise' && titleParts.length > 2) {
      const candidateCompany = titleParts[2].replace(/LinkedIn/i, '').trim();
      if (candidateCompany && !candidateCompany.toLowerCase().includes('linkedin')) {
        company = candidateCompany;
      }
    }

    // 4. Location
    const location = filters.city
      ? `${filters.city}, ${filters.country || 'United States'}`
      : filters.country || 'United States';

    return {
      fullName,
      headline: snippet || `${jobTitle} at ${company} | ${location}`,
      currentJobTitle: jobTitle,
      companyName: company,
      location,
      profileUrl,
      connectionsOrFollowers: 'N/A', // Public Google SERP does not expose follower counts
      lastActivityDate: 'N/A', // Public Google SERP does not expose activity timestamps
      source: 'Serper.dev Google Search API'
    };
  }

  async search(filters: LeadFilter): Promise<RawLead[]> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('Serper.dev API key is not configured. Please set SERPER_API_KEY in environment variables.');
    }

    const targetMax = Math.min(Math.max(filters.maxLeads || 50, 1), 500);
    const queries = this.generateQueries(filters);

    const accumulatedLeads: RawLead[] = [];
    const seenUrls = new Set<string>();

    for (const query of queries) {
      if (accumulatedLeads.length >= targetMax) break;

      const remaining = targetMax - accumulatedLeads.length;
      const numToFetch = Math.min(Math.max(remaining, 10), 100);

      let page = 1;
      const maxPagesPerQuery = Math.ceil(remaining / numToFetch);

      while (page <= maxPagesPerQuery && accumulatedLeads.length < targetMax) {
        const payload = {
          q: query,
          num: numToFetch,
          page: page,
          gl: 'us',
          hl: 'en'
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        try {
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
              'X-API-KEY': this.apiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.status === 401 || response.status === 403) {
            throw new Error('Invalid or unauthorized Serper.dev API Key. Please verify SERPER_API_KEY.');
          }

          if (response.status === 429) {
            throw new Error('Serper.dev API rate limit or credit limit reached.');
          }

          if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.message || `Serper.dev returned HTTP ${response.status}`);
          }

          const data = await response.json();
          const organicResults = data.organic || [];

          if (organicResults.length === 0) {
            break; // No more results for this sub-query
          }

          for (const item of organicResults) {
            const lead = this.extractLeadRecord(item, filters);
            if (lead && !seenUrls.has(lead.profileUrl.toLowerCase())) {
              seenUrls.add(lead.profileUrl.toLowerCase());
              accumulatedLeads.push(lead);

              if (accumulatedLeads.length >= targetMax) {
                break;
              }
            }
          }

          if (organicResults.length < numToFetch) {
            break; // Exhausted results for this query
          }

          page++;
        } catch (err: any) {
          if (err.name === 'AbortError') {
            throw new Error('Serper.dev request timed out (12s limit).');
          }
          throw err;
        }
      }
    }

    return accumulatedLeads.slice(0, targetMax);
  }
}
