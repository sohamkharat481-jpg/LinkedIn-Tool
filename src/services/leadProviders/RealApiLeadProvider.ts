import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';

export class RealApiLeadProvider implements LeadProvider {
  readonly providerId = 'real-api-provider';
  readonly providerName = 'Production B2B Public Search API';
  readonly isMock = false;

  private apiKey: string;
  private endpoint: string;

  constructor(apiKey: string, endpoint?: string) {
    this.apiKey = apiKey;
    this.endpoint = endpoint || '/api/lead-search-proxy';
  }

  async search(filters: LeadFilter): Promise<RawLead[]> {
    if (!this.apiKey && !process.env.LEAD_PROVIDER_API_KEY) {
      throw new Error('Production Lead Provider API key is missing. Please configure an API key in Settings.');
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Provider-Api-Key': this.apiKey || ''
        },
        body: JSON.stringify(filters)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Lead provider API error (Status ${response.status})`);
      }

      const data = await response.json();
      if (!Array.isArray(data.leads)) {
        throw new Error('Invalid response format from Lead Provider API.');
      }

      return data.leads.map((item: any) => ({
        fullName: String(item.fullName || item.name || '').trim(),
        headline: String(item.headline || item.title || '').trim(),
        currentJobTitle: String(item.currentJobTitle || item.jobTitle || '').trim(),
        companyName: String(item.companyName || item.company || '').trim(),
        location: String(item.location || '').trim(),
        profileUrl: String(item.profileUrl || item.url || '').trim(),
        connectionsOrFollowers: String(item.connectionsOrFollowers || item.connections || 'N/A').trim(),
        lastActivityDate: String(item.lastActivityDate || 'N/A').trim(),
        source: 'LinkedIn Public Search (API Provider)'
      }));
    } catch (err: any) {
      console.error('RealApiLeadProvider search error:', err);
      throw err;
    }
  }
}
