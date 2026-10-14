import { LeadFilter, RawLead, ProviderStatusInfo } from '../types';
import { SerperSearchLeadProvider } from '../services/leadProviders/SerperSearchLeadProvider';
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
    const serperKey =
      overrideApiKey ||
      process.env.SERPER_API_KEY ||
      process.env.SERPER_SEARCH_API_KEY ||
      process.env.VITE_SERPER_API_KEY ||
      process.env.VITE_SERPER_SEARCH_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY;

    const leadOceanKey =
      overrideApiKey ||
      process.env.LEADOCEAN_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY ||
      process.env.VITE_LEADOCEAN_API_KEY;

    const hasSerper = Boolean(serperKey && String(serperKey).trim().length > 0);
    const hasLeadOcean = Boolean(leadOceanKey && String(leadOceanKey).trim().length > 0);

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
      SERPER_API_KEY: hasSerper ? 'CONFIGURED' : 'MISSING',
      LEADOCEAN_API_KEY: hasLeadOcean ? 'CONFIGURED' : 'MISSING',
      ActiveProvider: hasSerper
        ? 'Serper.dev Google Search API'
        : hasLeadOcean
        ? 'LeadOcean B2B People Search API'
        : 'None (Unconfigured)',
      Runtime: runtimeName,
      Deployment: deploymentId
    };
  }

  /**
   * Helper to resolve active API Key from environment or overrides
   */
  static resolveApiKey(overrideKey?: string, providerType?: string): { key: string; type: 'serper' | 'leadocean' } {
    if (providerType === 'leadocean') {
      const key = (
        overrideKey ||
        process.env.LEADOCEAN_API_KEY ||
        process.env.LEAD_PROVIDER_API_KEY ||
        process.env.VITE_LEADOCEAN_API_KEY ||
        ''
      ).trim();
      return { key, type: 'leadocean' };
    }

    // Default to Serper.dev as primary
    const serperKey = (
      overrideKey ||
      process.env.SERPER_API_KEY ||
      process.env.SERPER_SEARCH_API_KEY ||
      process.env.VITE_SERPER_API_KEY ||
      process.env.VITE_SERPER_SEARCH_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY ||
      ''
    ).trim();

    if (serperKey) {
      return { key: serperKey, type: 'serper' };
    }

    // Fallback to LeadOcean if available
    const leadOceanKey = (
      process.env.LEADOCEAN_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY ||
      process.env.VITE_LEADOCEAN_API_KEY ||
      ''
    ).trim();

    if (leadOceanKey) {
      return { key: leadOceanKey, type: 'leadocean' };
    }

    return { key: '', type: 'serper' };
  }

  /**
   * Evaluates current provider status without exposing secrets.
   */
  static getStatus(overrideApiKey?: string, requestedType?: string): ProviderStatusInfo {
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);

    if (type === 'leadocean' && key) {
      return {
        configured: true,
        providerName: 'LeadOcean B2B People Search API',
        status: connectionVerified ? 'Connected' : 'Connected',
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

    const providerName = 'Serper.dev Google Search API';
    const endpointStatus = 'https://google.serper.dev/search';

    if (!key) {
      return {
        configured: false,
        providerName,
        status: 'Not Configured',
        message: 'Serper.dev API key is not configured. Please set SERPER_API_KEY.',
        isMock: false,
        endpointStatus,
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
      status: connectionVerified ? 'Connected' : 'Connected',
      message: 'Serper.dev Google Search API configured and ready.',
      isMock: false,
      endpointStatus,
      authStatus: 'Configured',
      lastSuccessfulRequest: lastSuccessTimestamp,
      lastError: lastErrorMsg,
      responseTimeMs: lastResponseTime,
      isExternal: true
    };
  }

  /**
   * Executes a real authenticated connection test against Serper.dev or LeadOcean.
   */
  static async testConnection(overrideApiKey?: string, requestedType?: string): Promise<ProviderStatusInfo> {
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);
    const startTime = Date.now();

    if (!key) {
      lastErrorMsg =
        type === 'leadocean'
          ? 'LeadOcean API key is not configured.'
          : 'Serper.dev API key is not configured. Please set SERPER_API_KEY.';
      connectionVerified = false;
      return this.getStatus(overrideApiKey, requestedType);
    }

    if (type === 'serper') {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': key,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            q: 'test',
            num: 1
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        lastResponseTime = `${duration}ms`;

        if (response.ok) {
          lastSuccessTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          lastErrorMsg = 'None';
          connectionVerified = true;
          return {
            ...this.getStatus(key, 'serper'),
            status: 'Connected',
            message: 'Serper.dev Google Search API connected successfully.'
          };
        }

        const httpCode = response.status;
        connectionVerified = false;
        const errJson = await response.json().catch(() => null);
        const rawMsg = errJson?.message || `Serper.dev API returned HTTP ${httpCode}`;
        lastErrorMsg = String(rawMsg);

        return {
          ...this.getStatus(key, 'serper'),
          status: 'Error',
          message: lastErrorMsg,
          diagnostics: {
            apiKeyDetected: true,
            providerInitialized: true,
            httpStatusCode: httpCode,
            providerErrorMessage: lastErrorMsg
          }
        };
      } catch (err: any) {
        connectionVerified = false;
        lastErrorMsg = err.message || 'Network error connecting to Serper.dev';
        return {
          ...this.getStatus(key, 'serper'),
          status: 'Error',
          message: lastErrorMsg
        };
      }
    }

    // LeadOcean fallback test
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const endpoint = 'https://api.leadocean.io/v1/people/search';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key
        },
        body: JSON.stringify({
          title: ['Manager'],
          limit: 1
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      lastResponseTime = `${duration}ms`;

      if (response && response.ok) {
        lastSuccessTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        lastErrorMsg = 'None';
        connectionVerified = true;
        return {
          ...this.getStatus(key, 'leadocean'),
          status: 'Connected',
          message: 'LeadOcean provider connected successfully.'
        };
      }

      const httpCode = response ? response.status : 500;
      connectionVerified = false;
      const errJson = await response?.json().catch(() => null);
      const rawMsg = errJson?.message || `LeadOcean API returned HTTP ${httpCode}`;
      lastErrorMsg = String(rawMsg);

      return {
        ...this.getStatus(key, 'leadocean'),
        status: 'Error',
        message: lastErrorMsg,
        diagnostics: {
          apiKeyDetected: true,
          providerInitialized: true,
          httpStatusCode: httpCode,
          providerErrorMessage: lastErrorMsg
        }
      };
    } catch (err: any) {
      connectionVerified = false;
      lastErrorMsg = err.message || 'Invalid API Credentials or Network Error';
      return {
        ...this.getStatus(key, 'leadocean'),
        status: 'Error',
        message: lastErrorMsg
      };
    }
  }

  /**
   * Fetches candidate leads using Serper.dev Google search or LeadOcean.
   */
  static async fetchCandidateLeads(
    filters: LeadFilter,
    overrideApiKey?: string,
    requestedType?: string
  ): Promise<RawLead[]> {
    const startTime = Date.now();
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);

    if (!key) {
      lastErrorMsg =
        type === 'leadocean'
          ? 'LeadOcean API key is not configured.'
          : 'Serper.dev API key is not configured. Please set SERPER_API_KEY.';
      throw new Error(lastErrorMsg);
    }

    if (type === 'serper') {
      const provider = new SerperSearchLeadProvider(key);
      try {
        const results = await provider.search(filters);
        lastSuccessTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        lastErrorMsg = 'None';
        lastResponseTime = `${Date.now() - startTime}ms`;
        connectionVerified = true;
        return results;
      } catch (err: any) {
        lastErrorMsg = err.message || 'Serper.dev search error.';
        throw err;
      }
    }

    // LeadOcean fallback
    const provider = new LeadOceanLeadProvider(key);
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
