import { LeadFilter, RawLead, ProviderStatusInfo } from '../types';
import { MockLeadProvider } from '../services/leadProviders/MockLeadProvider';
import { GoogleSearchLeadProvider } from '../services/leadProviders/GoogleSearchLeadProvider';

let lastSuccessTimestamp: string = 'None yet';
let lastErrorMsg: string = 'None';
let lastResponseTime: number | string = 'N/A';
let connectionVerified = false;

export class ServerLeadProviderService {
  /**
   * Evaluates the current server-side provider status and diagnostic metrics without exposing secrets.
   */
  static getStatus(overrideApiKey?: string, overrideMode?: string, overrideEngineId?: string): ProviderStatusInfo {
    const isMock = overrideMode === 'mock';

    if (isMock) {
      return {
        configured: true,
        providerName: 'Demo / Mock Data Provider',
        status: 'Connected',
        message: 'Mock Lead Provider is active for development and testing.',
        isMock: true,
        endpointStatus: 'Internal Simulation',
        authStatus: 'Mock Credentials Active',
        lastSuccessfulRequest: lastSuccessTimestamp,
        lastError: lastErrorMsg,
        responseTimeMs: lastResponseTime,
        isExternal: false
      };
    }

    const googleKey = overrideApiKey || process.env.GOOGLE_SEARCH_API_KEY || process.env.LEAD_PROVIDER_API_KEY;
    const googleCx = overrideEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID;
    const providerName = 'Google Custom Search / Programmable Search';

    const hasApiKey = Boolean(googleKey && googleKey.trim().length > 0);
    const hasEngineId = Boolean(googleCx && googleCx.trim().length > 0);

    if (!hasApiKey || !hasEngineId) {
      return {
        configured: false,
        providerName,
        status: 'Not Configured',
        message: 'Google Search provider is not configured.',
        isMock: false,
        endpointStatus: 'https://www.googleapis.com/customsearch/v1',
        authStatus: 'Not Configured',
        lastSuccessfulRequest: lastSuccessTimestamp,
        lastError: lastErrorMsg,
        responseTimeMs: lastResponseTime,
        isExternal: true
      };
    }

    if (connectionVerified) {
      return {
        configured: true,
        providerName,
        status: 'Connected',
        message: 'Google Search provider connected.',
        isMock: false,
        endpointStatus: 'Google Custom Search JSON API (v1)',
        authStatus: 'Configured',
        lastSuccessfulRequest: lastSuccessTimestamp,
        lastError: lastErrorMsg,
        responseTimeMs: lastResponseTime,
        isExternal: true
      };
    }

    return {
      configured: true,
      providerName,
      status: 'Connected',
      message: 'Google Search provider configured.',
      isMock: false,
      endpointStatus: 'Google Custom Search JSON API (v1)',
      authStatus: 'Configured',
      lastSuccessfulRequest: lastSuccessTimestamp,
      lastError: lastErrorMsg,
      responseTimeMs: lastResponseTime,
      isExternal: true
    };
  }

  /**
   * Executes a real authenticated connection test against Google Custom Search API.
   * NEVER uses MockLeadProvider.
   */
  static async testConnection(overrideApiKey?: string, overrideEngineId?: string): Promise<ProviderStatusInfo> {
    const googleKey = overrideApiKey || process.env.GOOGLE_SEARCH_API_KEY || process.env.LEAD_PROVIDER_API_KEY;
    const googleCx = overrideEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID;

    const startTime = Date.now();

    if (!googleKey || !googleCx || googleKey.trim() === '' || googleCx.trim() === '') {
      lastErrorMsg = 'Google Search provider is not configured.';
      connectionVerified = false;
      return this.getStatus(overrideApiKey, 'production', overrideEngineId);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const params = new URLSearchParams({
        key: googleKey,
        cx: googleCx,
        q: 'site:linkedin.com/in/ "Marketing Manager"',
        num: '1'
      });

      const endpoint = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;

      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal
      }).catch((err) => {
        if (err.name === 'AbortError') {
          throw new Error('Google Search API test request timed out.');
        }
        throw err;
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      lastResponseTime = `${duration}ms`;

      if (response && response.ok) {
        lastSuccessTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        lastErrorMsg = 'None';
        connectionVerified = true;
        return {
          ...this.getStatus(overrideApiKey, 'production', overrideEngineId),
          status: 'Connected',
          message: 'Google Search provider connected.'
        };
      }

      const errJson = await response.json().catch(() => ({}));
      const httpCode = response.status;
      connectionVerified = false;

      if (httpCode === 400 || httpCode === 403) {
        lastErrorMsg = 'Invalid API Credentials or Quota Exceeded';
      } else {
        lastErrorMsg = `Google Search API returned HTTP ${httpCode}`;
      }

      return {
        ...this.getStatus(overrideApiKey, 'production', overrideEngineId),
        status: 'Error',
        message: lastErrorMsg
      };
    } catch (err: any) {
      connectionVerified = false;
      lastErrorMsg = err.message || 'Invalid API Credentials or Network Error';
      return {
        ...this.getStatus(overrideApiKey, 'production', overrideEngineId),
        status: 'Error',
        message: lastErrorMsg
      };
    }
  }

  /**
   * Fetches candidate leads from Google Custom Search API.
   */
  static async fetchCandidateLeads(
    filters: LeadFilter,
    overrideApiKey?: string,
    overrideEngineId?: string,
    isMockRequested?: boolean
  ): Promise<RawLead[]> {
    const startTime = Date.now();

    if (isMockRequested) {
      const mockProvider = new MockLeadProvider();
      const mockResults = await mockProvider.search(filters);
      lastSuccessTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      lastResponseTime = `${Date.now() - startTime}ms`;
      return mockResults;
    }

    const googleKey = overrideApiKey || process.env.GOOGLE_SEARCH_API_KEY || process.env.LEAD_PROVIDER_API_KEY;
    const googleCx = overrideEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (!googleKey || !googleCx || googleKey.trim() === '' || googleCx.trim() === '') {
      lastErrorMsg = 'Google Search provider is not configured.';
      throw new Error(lastErrorMsg);
    }

    const provider = new GoogleSearchLeadProvider(googleKey, googleCx);

    try {
      const results = await provider.search(filters);
      lastSuccessTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      lastErrorMsg = 'None';
      lastResponseTime = `${Date.now() - startTime}ms`;
      connectionVerified = true;
      return results;
    } catch (err: any) {
      lastErrorMsg = err.message || 'Google Search provider error.';
      throw err;
    }
  }
}
