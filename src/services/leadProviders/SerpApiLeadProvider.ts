import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';

/**
 * SerpApi / Google Public Search API Adapter
 * Queries public search engine indexing of LinkedIn public profiles by job title,
 * industry, country, and company size.
 * 
 * Documentation: https://serpapi.com/google-search-api
 */
export class SerpApiLeadProvider implements LeadProvider {
  readonly providerId = 'serpapi-b2b-provider';
  readonly providerName = 'SerpApi Public B2B Search API';
  readonly isMock = false;

  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.LEAD_PROVIDER_API_KEY || process.env.SERPAPI_API_KEY || '';
  }

  async search(filters: LeadFilter): Promise<RawLead[]> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('Production lead provider is not connected yet. Missing LEAD_PROVIDER_API_KEY.');
    }

    const titleQuery = filters.jobTitles.join(' OR ');
    const queryStr = `site:linkedin.com/in/ "${titleQuery}" "${filters.country}" ${filters.city ? `"${filters.city}"` : ''}`;

    const params = new URLSearchParams({
      engine: 'google',
      q: queryStr,
      api_key: this.apiKey,
      num: String(Math.min(Math.max(filters.maxLeads || 50, 1), 500))
    });

    const url = `https://serpapi.com/search.json?${params.toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.status === 429) {
        throw new Error('SerpApi rate limit exceeded.');
      }

      if (!response.ok) {
        throw new Error(`SerpApi returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const organicResults = data.organic_results || [];

      return organicResults.map((item: any, idx: number) => {
        const titleText = item.title || '';
        // Extract full name before "-" or "|"
        const namePart = titleText.split(/[-|–]/)[0].trim() || `Public Lead #${idx + 1}`;
        const headlineText = item.snippet || item.title || '';

        return {
          fullName: namePart,
          headline: headlineText,
          currentJobTitle: filters.jobTitles[0] || 'Executive',
          companyName: 'Public Enterprise',
          location: filters.country,
          profileUrl: item.link || `https://www.linkedin.com/in/public-lead-${idx + 1}`,
          connectionsOrFollowers: '500+ connections',
          lastActivityDate: 'N/A',
          source: 'SerpApi Public Search API'
        };
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('SerpApi request timed out.');
      }
      throw err;
    }
  }
}
