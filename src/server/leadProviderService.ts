import { LeadFilter, RawLead, ProviderStatusInfo } from '../types';
import { LeadOceanLeadProvider } from '../services/leadProviders/LeadOceanLeadProvider';
import { SerperSearchLeadProvider } from '../services/leadProviders/SerperSearchLeadProvider';

export type SupportedLeadProvider = 'serper' | 'leadocean';

interface ProviderState {
  connectionVerified: boolean;
  lastSuccessTimestamp: string;
  lastError: string;
  lastResponseTime: string | number;
}

export interface ProviderDiagnosticTestResult extends ProviderStatusInfo {
  success: boolean;
  httpStatus: number;
  provider: string;
  endpoint: string;
  placesReturned: number;
  responseTime: string;
  responseTimeMs: number;
  status: 'Connected' | 'Not Configured' | 'Error';
  sanitizedProviderError: string | null;
  timestamp: string;
}

const PROVIDERS: Record<SupportedLeadProvider, {
  name: string;
  endpoint: string;
  missingKeyMessage: string;
}> = {
  serper: {
    name: 'Serper.dev Google Search API',
    endpoint: 'https://google.serper.dev/search',
    missingKeyMessage: 'Serper.dev API key is not configured. Please set SERPER_API_KEY.'
  },
  leadocean: {
    name: 'LeadOcean B2B People Search API',
    endpoint: 'https://api.leadocean.io/v1/people/search',
    missingKeyMessage: 'LeadOcean API key is not configured.'
  }
};

const providerStates: Record<SupportedLeadProvider, ProviderState> = {
  serper: {
    connectionVerified: false,
    lastSuccessTimestamp: 'None yet',
    lastError: 'None',
    lastResponseTime: 'N/A'
  },
  leadocean: {
    connectionVerified: false,
    lastSuccessTimestamp: 'None yet',
    lastError: 'None',
    lastResponseTime: 'N/A'
  }
};

const isProductionRuntime = () => Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');

function isSupportedProvider(type?: string): type is SupportedLeadProvider {
  return type === 'serper' || type === 'leadocean';
}

function getProviderKey(type: SupportedLeadProvider, overrideKey?: string): string {
  const cleanedOverride =
    !isProductionRuntime() &&
    typeof overrideKey === 'string' &&
    overrideKey.trim() !== '' &&
    overrideKey !== 'undefined' &&
    overrideKey !== 'null'
      ? overrideKey.trim()
      : '';

  if (type === 'serper') {
    return (
      cleanedOverride ||
      process.env.SERPER_API_KEY ||
      process.env.SERPER_SEARCH_API_KEY ||
      process.env.VITE_SERPER_API_KEY ||
      ''
    ).trim();
  }

  return (
    cleanedOverride ||
    process.env.LEADOCEAN_API_KEY ||
    process.env.LEAD_PROVIDER_API_KEY ||
    process.env.VITE_LEADOCEAN_API_KEY ||
    ''
  ).trim();
}

export class ServerLeadProviderService {
  static getDiagnostics(overrideApiKey?: string) {
    const serperKey = getProviderKey('serper', overrideApiKey);
    const leadOceanKey = getProviderKey('leadocean', overrideApiKey);
    const runtimeName = process.env.VERCEL
      ? 'Vercel Serverless'
      : process.env.K_SERVICE
      ? 'Google Cloud Run / Node Runtime'
      : 'Node.js Express Server';
    const deploymentId =
      process.env.VERCEL_DEPLOYMENT_ID ||
      process.env.APP_URL ||
      'Unknown deployment';

    return {
      SERPER_API_KEY: serperKey ? 'CONFIGURED' : 'MISSING',
      LEADOCEAN_API_KEY: leadOceanKey ? 'CONFIGURED' : 'MISSING',
      ActiveProvider: 'Selected in Settings',
      Runtime: runtimeName,
      Deployment: deploymentId,
      DetectedEnvKeys: Object.keys(process.env).filter(
        key =>
          key.includes('SERPER') ||
          key.includes('LEADOCEAN') ||
          key.includes('LEAD_PROVIDER')
      )
    };
  }

  static resolveApiKey(
    overrideKey?: string,
    providerType?: string
  ): { key: string; type: SupportedLeadProvider } {
    const type = providerType || 'serper';
    if (!isSupportedProvider(type)) {
      throw new Error(`Unsupported lead provider: ${type}`);
    }
    return { key: getProviderKey(type, overrideKey), type };
  }

  static getStatus(overrideApiKey?: string, requestedType?: string): ProviderStatusInfo {
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);
    const provider = PROVIDERS[type];
    const state = providerStates[type];
    const configured = Boolean(key);

    return {
      configured,
      providerName: provider.name,
      status: !configured
        ? 'Not Configured'
        : state.connectionVerified
        ? 'Connected'
        : state.lastError !== 'None'
        ? 'Error'
        : 'Not Tested',
      message: !configured
        ? provider.missingKeyMessage
        : state.connectionVerified
        ? `${provider.name} verified and connected.`
        : state.lastError !== 'None'
        ? state.lastError
        : `${provider.name} is configured. Run a live connection test to verify it.`,
      isMock: false,
      endpointStatus: provider.endpoint,
      authStatus: !configured
        ? 'Not Configured'
        : state.connectionVerified
        ? 'Verified'
        : state.lastError !== 'None'
        ? 'Test Failed'
        : 'Configured (Untested)',
      lastSuccessfulRequest: state.lastSuccessTimestamp,
      lastError: state.lastError,
      responseTimeMs: state.lastResponseTime,
      isExternal: true
    };
  }

  static async testConnection(
    overrideApiKey?: string,
    requestedType?: string
  ): Promise<ProviderDiagnosticTestResult> {
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);
    const provider = PROVIDERS[type];
    const state = providerStates[type];
    const startTime = Date.now();
    const timestamp = () => new Date().toISOString();

    const result = (
      values: Pick<
        ProviderDiagnosticTestResult,
        'success' | 'httpStatus' | 'placesReturned' | 'configured' | 'status' | 'authStatus' | 'message' | 'sanitizedProviderError'
      >
    ): ProviderDiagnosticTestResult => {
      const duration = Date.now() - startTime;
      state.lastResponseTime = `${duration}ms`;
      return {
        ...values,
        isMock: false,
        endpointStatus: provider.endpoint,
        lastSuccessfulRequest: state.lastSuccessTimestamp,
        lastError: state.lastError,
        isExternal: true,
        providerName: provider.name,
        provider: provider.name,
        endpoint: provider.endpoint,
        responseTime: `${duration}ms`,
        responseTimeMs: duration,
        timestamp: timestamp()
      };
    };

    if (!key) {
      state.connectionVerified = false;
      state.lastError = provider.missingKeyMessage;
      return result({
        success: false,
        httpStatus: 401,
        placesReturned: 0,
        configured: false,
        status: 'Not Configured',
        authStatus: 'Missing Key',
        message: provider.missingKeyMessage,
        sanitizedProviderError: 'API key is missing or blank'
      });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);

    try {
      const response =
        type === 'serper'
          ? await fetch(provider.endpoint, {
              method: 'POST',
              headers: {
                'X-API-KEY': key,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                q: 'software companies in Mumbai, India',
                num: 2
              }),
              signal: controller.signal
            })
          : await fetch(provider.endpoint, {
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

      if (!response.ok) {
        const message = `${provider.name} returned HTTP ${response.status}.`;
        state.connectionVerified = false;
        state.lastError = message;
        return result({
          success: false,
          httpStatus: response.status,
          placesReturned: 0,
          configured: true,
          status: 'Error',
          authStatus: 'Provider Error',
          message,
          sanitizedProviderError: message
        });
      }

      let returnedCount = 0;
      if (type === 'serper') {
        try {
          const data = await response.json();
          returnedCount = Array.isArray(data.organic) ? data.organic.length : 0;
        } catch {
          const message = 'Serper.dev returned an invalid JSON response.';
          state.connectionVerified = false;
          state.lastError = message;
          return result({
            success: false,
            httpStatus: 502,
            placesReturned: 0,
            configured: true,
            status: 'Error',
            authStatus: 'Invalid Response',
            message,
            sanitizedProviderError: message
          });
        }
      }

      state.connectionVerified = true;
      state.lastSuccessTimestamp = timestamp();
      state.lastError = 'None';
      return result({
        success: true,
        httpStatus: response.status,
        placesReturned: returnedCount,
        configured: true,
        status: 'Connected',
        authStatus: 'Verified',
        message:
          type === 'serper'
            ? `Serper.dev connection succeeded. ${returnedCount} search result(s) were returned for the health-check query.`
            : 'LeadOcean accepted the bounded connection-test request.',
        sanitizedProviderError: null
      });
    } catch {
      const message = timedOut
        ? `${provider.name} connection test timed out.`
        : `Network error connecting to ${provider.name}.`;
      state.connectionVerified = false;
      state.lastError = message;
      return result({
        success: false,
        httpStatus: timedOut ? 504 : 502,
        placesReturned: 0,
        configured: true,
        status: 'Error',
        authStatus: timedOut ? 'Timeout' : 'Network Error',
        message,
        sanitizedProviderError: message
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static async fetchCandidateLeads(
    filters: LeadFilter,
    overrideApiKey?: string,
    requestedType?: string
  ): Promise<RawLead[]> {
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);
    const provider = PROVIDERS[type];
    const state = providerStates[type];
    if (!key) {
      state.connectionVerified = false;
      state.lastError = provider.missingKeyMessage;
      throw new Error(provider.missingKeyMessage);
    }

    const startTime = Date.now();
    try {
      const adapter =
        type === 'serper'
          ? new SerperSearchLeadProvider(key)
          : new LeadOceanLeadProvider(key);
      const leads = await adapter.search(filters);
      state.connectionVerified = true;
      state.lastSuccessTimestamp = new Date().toISOString();
      state.lastError = 'None';
      state.lastResponseTime = `${Date.now() - startTime}ms`;
      return leads;
    } catch (error) {
      state.connectionVerified = false;
      state.lastError = error instanceof Error ? error.message : `${provider.name} search failed.`;
      state.lastResponseTime = `${Date.now() - startTime}ms`;
      throw error;
    }
  }
}
