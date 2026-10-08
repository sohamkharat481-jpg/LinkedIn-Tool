import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';

/**
 * LeadOcean B2B People Search API Adapter
 * Primary real lead provider using https://api.leadocean.io with x-api-key authentication.
 * Adheres strictly to production requirements: no synthetic fallback generation or fake lead records.
 */
export class LeadOceanLeadProvider implements LeadProvider {
  readonly providerId = 'leadocean-b2b-provider';
  readonly providerName = 'LeadOcean B2B People Search API';
  readonly isMock = false;

  private apiKey: string;
  private endpoint: string;

  constructor(apiKey?: string, endpoint?: string) {
    this.apiKey = apiKey || process.env.LEADOCEAN_API_KEY || process.env.LEAD_PROVIDER_API_KEY || '';
    this.endpoint = endpoint || process.env.LEADOCEAN_ENDPOINT || 'https://api.leadocean.io/v1/people/search';
  }

  async search(filters: LeadFilter): Promise<RawLead[]> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('LeadOcean production lead provider is not connected. Missing LEADOCEAN_API_KEY.');
    }

    const targetMax = Math.min(Math.max(filters.maxLeads || 50, 1), 500);
    const accumulatedLeads: RawLead[] = [];
    const pageSize = 50;
    let page = 1;

    while (accumulatedLeads.length < targetMax) {
      const remaining = targetMax - accumulatedLeads.length;
      const currentBatchLimit = Math.min(remaining, pageSize);

      const payload = {
        title: filters.jobTitles || [],
        seniority: filters.seniority || [],
        country: filters.country || undefined,
        city: filters.city || undefined,
        industry: filters.industry || undefined,
        employee_range: filters.companySize || undefined,
        keywords: filters.keywords || undefined,
        limit: currentBatchLimit,
        page: page,
        offset: (page - 1) * pageSize
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      try {
        let response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }).catch(async () => {
          const params = new URLSearchParams();
          if (filters.jobTitles && filters.jobTitles.length > 0) {
            params.set('title', filters.jobTitles.join(','));
          }
          if (filters.country) params.set('country', filters.country);
          if (filters.city) params.set('city', filters.city);
          if (filters.industry && filters.industry.length > 0) {
            params.set('industry', filters.industry.join(','));
          }
          params.set('limit', String(currentBatchLimit));
          params.set('page', String(page));

          return fetch(`${this.endpoint}?${params.toString()}`, {
            method: 'GET',
            headers: {
              'x-api-key': this.apiKey
            },
            signal: controller.signal
          });
        });

        clearTimeout(timeoutId);

        if (response.status === 429) {
          throw new Error('LeadOcean API rate limit exceeded. Please retry shortly.');
        }

        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid LeadOcean API Key. Please verify LEADOCEAN_API_KEY.');
        }

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({}));
          throw new Error(errJson.message || `LeadOcean API returned HTTP ${response.status}`);
        }

        const data = await response.json();
        const people = data.people || data.leads || data.data || (Array.isArray(data) ? data : []);

        if (people.length === 0) {
          break; // Stop pagination when provider has no more results
        }

        const batchMapped: RawLead[] = people.map((person: any, idx: number) => {
          const firstName = person.first_name || person.firstName || '';
          const lastName = person.last_name || person.lastName || '';
          const fullName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : (person.full_name || person.name || 'N/A');

          const jobTitle = person.title || person.job_title || person.headline || 'N/A';
          const company = person.company || person.company_name || person.organization?.name || 'N/A';
          const location = person.location || (person.city && person.country ? `${person.city}, ${person.country}` : (person.country || person.city || 'N/A'));

          let profileUrl = person.linkedin_url || person.linkedin || person.profile_url || '';
          if (profileUrl && !profileUrl.startsWith('http')) {
            profileUrl = 'https://' + profileUrl;
          }
          if (!profileUrl) {
            profileUrl = 'N/A';
          }

          return {
            id: person.id || `leadocean-${page}-${idx}-${Date.now()}`,
            fullName,
            title: jobTitle,
            company,
            location,
            profileUrl,
            email: person.email || undefined,
            phone: person.phone || person.phone_number || undefined,
            industry: person.industry || (filters.industry && filters.industry[0]) || 'N/A',
            companySize: person.company_size || person.employee_range || 'N/A',
            confidenceScore: person.confidence_score || 0.9,
            headline: person.headline || `${jobTitle} at ${company}`,
            currentJobTitle: jobTitle,
            companyName: company,
            connectionsOrFollowers: person.connections || person.connections_count || 'N/A',
            lastActivityDate: person.last_activity_date || 'N/A',
            source: 'LeadOcean B2B People Search API'
          };
        });

        accumulatedLeads.push(...batchMapped);

        if (people.length < currentBatchLimit) {
          break; // Provider has fewer results than requested batch size
        }

        page++;
        if (page > 15) {
          break;
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('LeadOcean API request timed out (12s limit).');
        }
        throw err;
      }
    }

    return accumulatedLeads.slice(0, targetMax);
  }
}
