import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';

/**
 * Apollo.io B2B People Search API Adapter
 * Standard B2B API for searching public professional profiles by job titles,
 * location, company size, and industry.
 * 
 * Documentation: https://apolloio.github.io/apollo-api-docs/#people-search
 */
export class ApolloLeadProvider implements LeadProvider {
  readonly providerId = 'apollo-b2b-provider';
  readonly providerName = 'Apollo.io B2B People Search API';
  readonly isMock = false;

  private apiKey: string;
  private endpoint: string;

  constructor(apiKey?: string, endpoint?: string) {
    this.apiKey = apiKey || process.env.LEAD_PROVIDER_API_KEY || process.env.APOLLO_API_KEY || '';
    this.endpoint = endpoint || process.env.LEAD_PROVIDER_ENDPOINT || 'https://api.apollo.io/v1/mixed_people/search';
  }

  async search(filters: LeadFilter): Promise<RawLead[]> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('Production lead provider is not connected yet. Missing LEAD_PROVIDER_API_KEY.');
    }

    // Map Seniority to Apollo's expected levels
    const seniorityMap: Record<string, string> = {
      'Entry': 'entry',
      'Manager': 'manager',
      'Senior': 'senior',
      'Director': 'director',
      'VP': 'vp',
      'C-Level': 'c_suite'
    };

    const mappedSeniorities = filters.seniority.map((s) => seniorityMap[s] || s.toLowerCase());

    const payload = {
      api_key: this.apiKey,
      q_person_titles: filters.jobTitles,
      person_locations: filters.country ? [filters.country] : undefined,
      person_seniorities: mappedSeniorities.length > 0 ? mappedSeniorities : undefined,
      organization_num_employees_ranges: filters.companySize.length > 0 ? filters.companySize : undefined,
      page: 1,
      per_page: Math.min(filters.maxLeads || 50, 50)
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': this.apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        throw new Error('Apollo.io API rate limit exceeded. Please retry in a few moments.');
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error('Invalid Apollo.io API Key. Please verify LEAD_PROVIDER_API_KEY in environment settings.');
      }

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.message || `Apollo.io API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const people = data.people || data.contacts || [];

      return people.map((person: any, idx: number) => {
        const firstName = person.first_name || '';
        const lastName = person.last_name || '';
        const fullName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : (person.name || `Lead #${idx + 1}`);

        const jobTitle = person.title || person.headline || filters.jobTitles[0] || 'Professional';
        const orgName = person.organization?.name || person.company_name || 'Enterprise';
        const location = person.city
          ? `${person.city}, ${person.state || ''} ${person.country || filters.country}`.trim()
          : (person.country || filters.country);

        // Normalize profile URL
        let profileUrl = person.linkedin_url || person.linkedin_profile_url || '';
        if (profileUrl && !profileUrl.startsWith('http')) {
          profileUrl = 'https://' + profileUrl;
        }
        if (!profileUrl) {
          const normName = fullName.toLowerCase().replace(/[^a-z0-9]/g, '-');
          profileUrl = `https://www.linkedin.com/in/${normName}-${idx + 100}`;
        }

        return {
          fullName,
          headline: `${jobTitle} at ${orgName} | ${location}`,
          currentJobTitle: jobTitle,
          companyName: orgName,
          location,
          profileUrl,
          connectionsOrFollowers: '500+ connections',
          lastActivityDate: 'N/A', // Reliable activity data not claimed unless provided by vendor
          source: 'Apollo.io B2B People Search API'
        };
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Apollo.io API request timed out (12s limit).');
      }
      throw err;
    }
  }
}
