import { LeadFilter, RawLead, ProviderStatusInfo } from '../types';
import { MockLeadProvider } from '../services/leadProviders/MockLeadProvider';
import { LeadOceanLeadProvider } from '../services/leadProviders/LeadOceanLeadProvider';

let lastSuccessTimestamp: string = 'None yet';
let lastErrorMsg: string = 'None';
let lastResponseTime: number | string = 'N/A';
let connectionVerified = false;

export class ServerLeadProviderService {
  /**
   * Safe Diagnostic Status (Does NOT expose secret values)
   */
  static getDiagnostics(overrideApiKey?: string) {
    const leadOceanKey =
      overrideApiKey ||
      process.env.LEADOCEAN_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY;

    const hasKey = Boolean(leadOceanKey && String(leadOceanKey).trim().length > 0);

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
      LEADOCEAN_API_KEY: hasKey ? 'CONFIGURED' : 'MISSING',
      Runtime: runtimeName,
      Deployment: deploymentId
    };
  }

  /**
   * Helper to resolve LeadOcean API Key from environment or overrides
   */
  private static resolveApiKey(overrideKey?: string): string {
    return (
      overrideKey ||
      process.env.LEADOCEAN_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY ||
      ''
    ).trim();
  }

  /**
   * Evaluates current provider status without exposing secrets.
   */
  static getStatus(overrideApiKey?: string, overrideMode?: string): ProviderStatusInfo {
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

    const apiKey = this.resolveApiKey(overrideApiKey);
    const providerName = 'LeadOcean B2B People Search API';
    const hasKey = Boolean(apiKey && apiKey.length > 0);

    if (!hasKey) {
      return {
        configured: false,
        providerName,
        status: 'Not Configured',
        message: 'LeadOcean API key is not configured. Please set LEADOCEAN_API_KEY.',
        isMock: false,
        endpointStatus: 'https://api.leadocean.io/v1/people/search',
        authStatus: 'Not Configured',
        lastSuccessfulRequest: lastSuccessTimestamp,
        lastError: lastErrorMsg,
        responseTimeMs: lastResponseTime,
        isExternal: true
      };
    }

    return {
      configured: true,
      providerName,
      status: connectionVerified ? 'Connected' : 'Not Configured',
      message: 'LeadOcean provider configured.',
      isMock: false,
      endpointStatus: 'https://api.leadocean.io/v1/people/search',
      authStatus: 'Configured',
      lastSuccessfulRequest: lastSuccessTimestamp,
      lastError: lastErrorMsg,
      responseTimeMs: lastResponseTime,
      isExternal: true
    };
  }

  /**
   * Executes a real authenticated connection test against LeadOcean API.
   */
  static async testConnection(overrideApiKey?: string): Promise<ProviderStatusInfo> {
    const apiKey = this.resolveApiKey(overrideApiKey);
    const startTime = Date.now();

    if (!apiKey) {
      lastErrorMsg = 'LeadOcean API key is not configured.';
      connectionVerified = false;
      return this.getStatus(overrideApiKey, 'production');
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const endpoint = 'https://api.leadocean.io/v1/people/search';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify({
          title: ['Manager'],
          limit: 1
        }),
        signal: controller.signal
      }).catch(async () => {
        return fetch(`${endpoint}?limit=1`, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey
          },
          signal: controller.signal
        });
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      lastResponseTime = `${duration}ms`;

      if (response && response.ok) {
        lastSuccessTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        lastErrorMsg = 'None';
        connectionVerified = true;
        return {
          ...this.getStatus(overrideApiKey, 'production'),
          status: 'Connected',
          message: 'LeadOcean provider connected successfully.'
        };
      }

      const httpCode = response ? response.status : 500;
      connectionVerified = false;

      const errJson = await response?.json().catch(() => null);
      const rawMsg = errJson?.message || errJson?.error || `LeadOcean API returned HTTP ${httpCode}`;
      lastErrorMsg = rawMsg;

      return {
        ...this.getStatus(overrideApiKey, 'production'),
        status: 'Error',
        message: lastErrorMsg,
        diagnostics: {
          apiKeyDetected: true,
          providerInitialized: true,
          httpStatusCode: httpCode,
          googleErrorMessage: rawMsg
        }
      };
    } catch (err: any) {
      connectionVerified = false;
      lastErrorMsg = err.message || 'Invalid API Credentials or Network Error';
      return {
        ...this.getStatus(overrideApiKey, 'production'),
        status: 'Error',
        message: lastErrorMsg
      };
    }
  }

  /**
   * Fetches candidate leads from LeadOcean API.
   */
  static async fetchCandidateLeads(
    filters: LeadFilter,
    overrideApiKey?: string,
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

    const apiKey = this.resolveApiKey(overrideApiKey);

    if (!apiKey) {
      lastErrorMsg = 'LeadOcean API key is not configured.';
      throw new Error(lastErrorMsg);
    }

    const provider = new LeadOceanLeadProvider(apiKey);

    try {
      const results = await provider.search(filters);
      lastSuccessTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      lastErrorMsg = 'None';
      lastResponseTime = `${Date.now() - startTime}ms`;
      connectionVerified = true;
      return results;
    } catch (err: any) {
      lastErrorMsg = err.message || 'LeadOcean provider error.';
      throw err;
    }
  }
}
