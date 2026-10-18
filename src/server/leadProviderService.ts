import { LeadFilter, RawLead, ProviderStatusInfo } from '../types';
import { WikidataLeadProvider } from '../services/leadProviders/WikidataLeadProvider';

export type SupportedLeadProvider = 'wikidata';

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
  wikidata: {
    name: 'Wikidata SPARQL Query Service',
    endpoint: 'https://query.wikidata.org/sparql',
    missingKeyMessage: 'Wikidata does not require an API key.'
  }
};

const providerStates: Record<SupportedLeadProvider, ProviderState> = {
  wikidata: {
    connectionVerified: false,
    lastSuccessTimestamp: 'None yet',
    lastError: 'None',
    lastResponseTime: 'N/A'
  }
};

function isSupportedProvider(type?: string): type is SupportedLeadProvider {
  return type === 'wikidata';
}

export class ServerLeadProviderService {
  static getDiagnostics() {
    return {
      ActiveProvider: 'Wikidata',
      Runtime: process.env.VERCEL ? 'Vercel Serverless' : 'Node.js Server',
      Deployment: process.env.APP_URL || 'Unknown deployment',
    };
  }

  static getStatus(): ProviderStatusInfo {
    const provider = PROVIDERS['wikidata'];
    const state = providerStates['wikidata'];

    return {
      configured: true,
      providerName: provider.name,
      status: state.connectionVerified ? 'Connected' : 'Not Tested',
      message: state.connectionVerified
        ? `${provider.name} verified and connected.`
        : `${provider.name} is configured. Run a live connection test to verify it.`,
      isMock: false,
      endpointStatus: provider.endpoint,
      authStatus: 'None required',
      lastSuccessfulRequest: state.lastSuccessTimestamp,
      lastError: state.lastError,
      responseTimeMs: state.lastResponseTime,
      isExternal: true
    };
  }

  static async testConnection(): Promise<ProviderDiagnosticTestResult> {
    const provider = PROVIDERS['wikidata'];
    const state = providerStates['wikidata'];
    const startTime = Date.now();
    const timestamp = () => new Date().toISOString();

    try {
      const providerInstance = new WikidataLeadProvider();
      // Run a simple test query
      await providerInstance.testConnection();
      
      state.connectionVerified = true;
      state.lastSuccessTimestamp = timestamp();
      state.lastError = 'None';
      const duration = Date.now() - startTime;
      
      return {
        success: true,
        httpStatus: 200,
        placesReturned: 0,
        configured: true,
        status: 'Connected',
        authStatus: 'None required',
        message: 'Wikidata connection verified.',
        sanitizedProviderError: null,
        provider: provider.name,
        providerName: provider.name,
        endpoint: provider.endpoint,
        endpointStatus: provider.endpoint,
        responseTime: `${duration}ms`,
        responseTimeMs: duration,
        timestamp: timestamp(),
        lastSuccessfulRequest: state.lastSuccessTimestamp,
        lastError: state.lastError,
        isExternal: true,
        isMock: false
      };
    } catch (error) {
      state.connectionVerified = false;
      state.lastError = error instanceof Error ? error.message : 'Wikidata connection test failed.';
      const duration = Date.now() - startTime;
      return {
        success: false,
        httpStatus: 502,
        placesReturned: 0,
        configured: true,
        status: 'Error',
        authStatus: 'Connection Failed',
        message: state.lastError,
        sanitizedProviderError: state.lastError,
        provider: provider.name,
        providerName: provider.name,
        endpoint: provider.endpoint,
        endpointStatus: provider.endpoint,
        responseTime: `${duration}ms`,
        responseTimeMs: duration,
        timestamp: timestamp(),
        lastSuccessfulRequest: state.lastSuccessTimestamp,
        lastError: state.lastError,
        isExternal: true,
        isMock: false
      };
    }
  }

  static async fetchCandidateLeads(filters: LeadFilter): Promise<RawLead[]> {
    const provider = new WikidataLeadProvider();
    const state = providerStates['wikidata'];
    const startTime = Date.now();
    
    try {
      const leads = await provider.search(filters);
      state.connectionVerified = true;
      state.lastSuccessTimestamp = new Date().toISOString();
      state.lastError = 'None';
      state.lastResponseTime = `${Date.now() - startTime}ms`;
      return leads;
    } catch (error) {
      state.connectionVerified = false;
      state.lastError = error instanceof Error ? error.message : 'Wikidata search failed.';
      state.lastResponseTime = `${Date.now() - startTime}ms`;
      throw error;
    }
  }
}
