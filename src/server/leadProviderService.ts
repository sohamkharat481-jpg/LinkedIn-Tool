import { LeadFilter, RawLead, ProviderStatusInfo } from '../types';
import { MockLeadProvider } from '../services/leadProviders/MockLeadProvider';
import { GoogleSearchLeadProvider } from '../services/leadProviders/GoogleSearchLeadProvider';

let lastSuccessTimestamp: string = 'None yet';
let lastErrorMsg: string = 'None';
let lastResponseTime: number | string = 'N/A';
let connectionVerified = false;

export class ServerLeadProviderService {
  /**
   * Safe Diagnostic Status (Does NOT expose secret values)
   */
  static getDiagnostics(overrideApiKey?: string, overrideEngineId?: string) {
    const googleKey =
      overrideApiKey ||
      process.env.GOOGLE_SEARCH_API_KEY ||
      process.env.VITE_GOOGLE_SEARCH_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY ||
      process.env.APOLLO_API_KEY;

    const googleCx =
      overrideEngineId ||
      process.env.GOOGLE_SEARCH_ENGINE_ID ||
      process.env.VITE_GOOGLE_SEARCH_ENGINE_ID;

    const hasKey = Boolean(googleKey && String(googleKey).trim().length > 0);
    const hasEngineId = Boolean(googleCx && String(googleCx).trim().length > 0);

    const runtimeName = process.env.VERCEL
      ? 'Vercel Serverless'
      : process.env.K_SERVICE
      ? 'Google Cloud Run / Node Runtime'
      : 'Node.js Express Server';

    const deploymentId =
      process.env.VERCEL_DEPLOYMENT_ID ||
      process.env.APP_URL ||
      'applet-4d041d80-4453-4ab7';

    return {
      GOOGLE_SEARCH_API_KEY: hasKey ? 'CONFIGURED' : 'MISSING',
      GOOGLE_SEARCH_ENGINE_ID: hasEngineId ? 'CONFIGURED' : 'MISSING',
      Runtime: runtimeName,
      Deployment: deploymentId
    };
  }

  /**
   * Helper to resolve Google API Key from environment or overrides
   */
  private static resolveApiKey(overrideKey?: string): string {
    return (
      overrideKey ||
      process.env.GOOGLE_SEARCH_API_KEY ||
      process.env.VITE_GOOGLE_SEARCH_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY ||
      process.env.APOLLO_API_KEY ||
      ''
    ).trim();
  }

  /**
   * Helper to resolve Google Search Engine ID from environment or overrides
   */
  private static resolveEngineId(overrideCx?: string): string {
    return (
      overrideCx ||
      process.env.GOOGLE_SEARCH_ENGINE_ID ||
      process.env.VITE_GOOGLE_SEARCH_ENGINE_ID ||
      '41f25e8b9b4d94578'
    ).trim();
  }

  /**
   * Evaluates current provider status without exposing secrets.
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

    const googleKey = this.resolveApiKey(overrideApiKey);
    const googleCx = this.resolveEngineId(overrideEngineId);
    const providerName = 'Google Custom Search / Programmable Search';

    const hasApiKey = Boolean(googleKey && googleKey.length > 0);
    const hasEngineId = Boolean(googleCx && googleCx.length > 0);

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
    const googleKey = this.resolveApiKey(overrideApiKey);
    const googleCx = this.resolveEngineId(overrideEngineId);

    const startTime = Date.now();

    if (!googleKey || !googleCx) {
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

      const httpCode = response.status;
      connectionVerified = false;

      const errJson = await response.json().catch(() => null);
      let rawMsg = (errJson?.error?.message || '').replace(new RegExp(googleKey, 'g'), '[REDACTED_KEY]');
      if (googleCx) rawMsg = rawMsg.replace(new RegExp(googleCx, 'g'), '[REDACTED_CX]');
      const rawReason = errJson?.error?.errors?.[0]?.reason || '';

      let apiEnabled = 'UNKNOWN';
      let credentialsValid = 'UNKNOWN';
      let apiRestrictionIssue = 'UNKNOWN';
      let quotaBillingIssue = 'UNKNOWN';
      let searchEngineValid = 'UNKNOWN';

      const lowerMsg = rawMsg.toLowerCase();

      if (rawReason === 'keyInvalid' || lowerMsg.includes('api key not valid') || lowerMsg.includes('key invalid')) {
        credentialsValid = 'NO';
        lastErrorMsg = 'Invalid Google API Key';
      } else if (
        rawReason === 'accessNotConfigured' ||
        rawReason === 'forbidden' ||
        lowerMsg.includes('has not been used in project') ||
        lowerMsg.includes('does not have the access to custom search') ||
        lowerMsg.includes('is disabled')
      ) {
        apiEnabled = 'NO';
        credentialsValid = 'YES';
        lastErrorMsg = 'Google Custom Search JSON API = UNAVAILABLE FOR NEW CUSTOMERS';
      } else if (
        rawReason === 'ipRefererBlocked' ||
        lowerMsg.includes('api key restricted') ||
        lowerMsg.includes('referer') ||
        lowerMsg.includes('ip address')
      ) {
        apiRestrictionIssue = 'YES';
        credentialsValid = 'YES';
        lastErrorMsg = 'API key restriction issue (IP/HTTP Referer restriction)';
      } else if (rawReason === 'invalidParameter' || lowerMsg.includes('cx') || lowerMsg.includes('search engine')) {
        searchEngineValid = 'NO';
        credentialsValid = 'YES';
        lastErrorMsg = 'Invalid Search Engine ID (cx)';
      } else if (
        rawReason === 'dailyLimitExceeded' ||
        rawReason === 'userRateLimitExceeded' ||
        lowerMsg.includes('quota') ||
        lowerMsg.includes('billing')
      ) {
        quotaBillingIssue = 'YES';
        credentialsValid = 'YES';
        lastErrorMsg = 'Google Custom Search API quota or billing limit reached';
      } else {
        lastErrorMsg = rawMsg || `Google Custom Search API returned HTTP ${httpCode}`;
      }

      return {
        ...this.getStatus(overrideApiKey, 'production', overrideEngineId),
        status: 'Error',
        message: lastErrorMsg,
        diagnostics: {
          apiKeyDetected: true,
          searchEngineIdDetected: true,
          providerInitialized: true,
          apiEnabled,
          credentialsValid,
          apiRestrictionIssue,
          quotaBillingIssue,
          searchEngineValid,
          httpStatusCode: httpCode,
          googleErrorMessage: rawMsg
        }
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

    const googleKey = this.resolveApiKey(overrideApiKey);
    const googleCx = this.resolveEngineId(overrideEngineId);

    if (!googleKey || !googleCx) {
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
