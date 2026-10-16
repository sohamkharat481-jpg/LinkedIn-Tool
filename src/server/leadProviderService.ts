import { LeadFilter, RawLead, ProviderStatusInfo } from '../types';
import { GoogleMapsPlacesLeadProvider } from '../services/leadProviders/GoogleMapsPlacesLeadProvider';
import { diagnoseGooglePlacesFailure } from '../services/leadProviders/googlePlacesErrors';
import { SerperSearchLeadProvider } from '../services/leadProviders/SerperSearchLeadProvider';
import { LeadOceanLeadProvider } from '../services/leadProviders/LeadOceanLeadProvider';
import {
  OverpassApiError,
  OverpassLeadProvider,
  OverpassRequestDiagnostics
} from '../services/leadProviders/OverpassLeadProvider';
import {
  WIKIDATA_ENDPOINT,
  WikidataLeadProvider,
  WikidataProviderError
} from '../services/leadProviders/WikidataLeadProvider';
import {
  NetworkDiagnosticContext,
  NetworkRequestDiagnostics
} from '../services/leadProviders/networkDiagnostics';

let lastSuccessTimestamp: string = 'None yet';
let lastErrorMsg: string = 'None';
let lastResponseTime: number | string = 'N/A';
let connectionVerified = false;
let overpassConnectionVerified = false;
let overpassLastSuccessTimestamp = 'None yet';
let overpassLastError = 'None';
let overpassLastResponseTime: number | string = 'N/A';
let overpassLastDiagnostics: OverpassRequestDiagnostics = {};
let wikidataConnectionVerified = false;
let wikidataLastSuccessTimestamp = 'None yet';
let wikidataLastError = 'None';
let wikidataLastResponseTime: number | string = 'N/A';

const isProductionRuntime = () => Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');

function getOverpassHealthCheckBudgetMs(): number {
  const configured = Number(process.env.OVERPASS_HEALTH_CHECK_BUDGET_MS);
  if (!Number.isFinite(configured) || configured <= 0) return 8000;
  return Math.min(Math.max(Math.floor(configured), 1000), 15000);
}

function overpassDiagnosticHttpStatus(upstreamStatus: number): number {
  if (upstreamStatus === 429) return 429;
  if (upstreamStatus === 503) return 503;
  if (upstreamStatus === 504) return 504;
  if (upstreamStatus >= 500) return 502;
  return upstreamStatus >= 400 ? 502 : 503;
}

const googleMapsApiKey = () =>
  process.env.GOOGLE_MAPS_API_KEY ||
  (!isProductionRuntime()
    ? process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.PLACES_API_KEY
    : '');

const googlePlacesTestRequest = {
  method: 'POST',
  url: 'https://places.googleapis.com/v1/places:searchText',
  headers: {
    contentType: 'application/json',
    apiKey: 'X-Goog-Api-Key (value redacted)',
    fieldMask: 'places.id,places.displayName,places.formattedAddress'
  },
  body: {
    textQuery: 'software companies in Mumbai, India',
    pageSize: 2
  }
};

const googleAuthStatus = (category: string) => {
  switch (category) {
    case 'invalid_api_key':
      return 'Invalid API Key';
    case 'api_key_restriction':
      return 'API Key Restriction Error';
    case 'api_not_enabled':
      return 'Places API Not Enabled';
    case 'billing_disabled':
      return 'Billing Disabled';
    case 'google_cloud_project':
      return 'Google Cloud Project Error';
    case 'iam_or_service_permission':
      return 'IAM/Service Permission Error';
    default:
      return 'Permission Denied (Reason Unclassified)';
  }
};

export interface ProviderDiagnosticTestResult {
  success: boolean;
  httpStatus: number;
  provider: string;
  endpoint: string;
  placesReturned: number;
  responseTime: string;
  responseTimeMs: number;
  configured: boolean;
  status: 'Connected' | 'Not Configured' | 'Error';
  authStatus: string;
  message: string;
  sanitizedProviderError: string | null;
  timestamp: string;
  attemptCount?: number;
  upstreamHttpStatus?: number;
  elapsedMs?: number;
  timeoutReason?: string;
  diagnostics?: Partial<NetworkRequestDiagnostics> & {
    upstreamHttpStatus?: number;
    attemptCount?: number;
    elapsedMs?: number;
    timeoutReason?: string;
    requestStartedAt?: string;
    requestStartedElapsedMs?: number;
    responseHeadersElapsedMs?: number;
    httpStatus?: number;
    responseBodyCompletedElapsedMs?: number;
    jsonParsingCompletedElapsedMs?: number;
    jsonParsingDurationMs?: number;
    failurePhase?: OverpassRequestDiagnostics['failurePhase'];
    apiKeyDetected?: boolean;
    providerInitialized?: boolean;
    httpStatusCode?: number;
    placesReturned?: number;
    providerErrorMessage?: string;
    googleErrorMessage?: string;
    credentialSource?: string;
    request?: typeof googlePlacesTestRequest;
    googleError?: {
      code?: number;
      status?: string;
      message: string;
      details: unknown[];
    };
    permissionDiagnosis?: {
      category: string;
      reason?: string;
      action: string;
      consumerProject?: string;
    };
  };
}

export class ServerLeadProviderService {
  /**
   * Safe Diagnostic Status (Does NOT expose secret values)
   */
  static getDiagnostics(overrideApiKey?: string) {
    const safeOverride = isProductionRuntime() ? '' : overrideApiKey;
    const cleanedOverride =
      safeOverride &&
      typeof safeOverride === 'string' &&
      safeOverride.trim() !== '' &&
      safeOverride !== 'undefined' &&
      safeOverride !== 'null'
        ? safeOverride.trim()
        : '';

    const googleMapsKey = cleanedOverride || googleMapsApiKey();

    const serperKey =
      cleanedOverride ||
      process.env.SERPER_API_KEY ||
      process.env.SERPER_SEARCH_API_KEY ||
      process.env.VITE_SERPER_API_KEY ||
      process.env.VITE_SERPER_SEARCH_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY;

    const leadOceanKey =
      cleanedOverride ||
      process.env.LEADOCEAN_API_KEY ||
      process.env.LEAD_PROVIDER_API_KEY ||
      process.env.VITE_LEADOCEAN_API_KEY;

    const hasGoogleMaps = Boolean(googleMapsKey && String(googleMapsKey).trim().length > 0);
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
      GOOGLE_MAPS_API_KEY: hasGoogleMaps ? 'CONFIGURED' : 'MISSING',
      SERPER_API_KEY: hasSerper ? 'CONFIGURED' : 'MISSING',
      LEADOCEAN_API_KEY: hasLeadOcean ? 'CONFIGURED' : 'MISSING',
      ActiveProvider: hasGoogleMaps
        ? 'Google Maps Platform Places API (New)'
        : 'None (Google Maps Places API not configured)',
      Runtime: runtimeName,
      Deployment: deploymentId,
      connectionVerified,
      DetectedEnvKeys: Object.keys(process.env).filter(
        key =>
          key.includes('MAPS') ||
          key.includes('PLACES') ||
          key.includes('SERPER') ||
          key.includes('LEAD_PROVIDER')
      )
    };
  }

  /**
   * Helper to resolve active API Key from environment or overrides
   */
  static resolveApiKey(
    overrideKey?: string,
    providerType?: string
  ): { key: string; type: 'google_places' | 'serper' | 'leadocean' | 'overpass' | 'wikidata' } {
    if (providerType === 'overpass' || providerType === 'wikidata') {
      return { key: '', type: providerType };
    }

    const cleanedOverride = isProductionRuntime() ? '' : (
      overrideKey &&
      typeof overrideKey === 'string' &&
      overrideKey.trim() !== '' &&
      overrideKey !== 'undefined' &&
      overrideKey !== 'null'
        ? overrideKey.trim()
        : ''
    );

    if (providerType === 'serper') {
      const key = (
        cleanedOverride ||
        process.env.SERPER_API_KEY ||
        process.env.SERPER_SEARCH_API_KEY ||
        process.env.VITE_SERPER_API_KEY ||
        ''
      ).trim();
      return { key, type: 'serper' };
    }

    if (providerType === 'leadocean') {
      const key = (
        cleanedOverride ||
        process.env.LEADOCEAN_API_KEY ||
        process.env.LEAD_PROVIDER_API_KEY ||
        process.env.VITE_LEADOCEAN_API_KEY ||
        ''
      ).trim();
      return { key, type: 'leadocean' };
    }

    // Default primary provider: Google Maps Platform Places API (New)
    const googleMapsKey = (cleanedOverride || googleMapsApiKey() || '').trim();

    if (googleMapsKey) {
      return { key: googleMapsKey, type: 'google_places' };
    }

    return { key: '', type: 'google_places' };
  }

  /**
   * Evaluates current provider status without exposing secrets.
   * Accurately distinguishes between configured and verified live connection.
   */
  static getStatus(overrideApiKey?: string, requestedType?: string): ProviderStatusInfo {
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);

    if (type === 'overpass') {
      return {
        configured: true,
        providerName: 'OpenStreetMap Overpass API',
        status: overpassConnectionVerified ? 'Connected' : overpassLastError !== 'None' ? 'Error' : 'Not Tested',
        message: overpassConnectionVerified
          ? 'A live Overpass query succeeded.'
          : overpassLastError !== 'None'
          ? overpassLastError
          : 'No API key required. Run a live test to verify public Overpass access.',
        isMock: false,
        endpointStatus: 'https://overpass-api.de/api/interpreter',
        authStatus: 'No API key required',
        lastSuccessfulRequest: overpassLastSuccessTimestamp,
        lastError: overpassLastError,
        responseTimeMs: overpassLastResponseTime,
        isExternal: true,
        diagnostics: {
          httpStatusCode: overpassLastDiagnostics.upstreamHttpStatus,
          upstreamHttpStatus: overpassLastDiagnostics.upstreamHttpStatus,
          attemptCount: overpassLastDiagnostics.attemptCount,
          elapsedMs: overpassLastDiagnostics.elapsedMs,
          timeoutReason: overpassLastDiagnostics.timeoutReason,
          requestStartedAt: overpassLastDiagnostics.requestStartedAt,
          requestStartedElapsedMs: overpassLastDiagnostics.requestStartedElapsedMs,
          responseHeadersElapsedMs: overpassLastDiagnostics.responseHeadersElapsedMs,
          httpStatus: overpassLastDiagnostics.httpStatus,
          responseBodyCompletedElapsedMs: overpassLastDiagnostics.responseBodyCompletedElapsedMs,
          jsonParsingCompletedElapsedMs: overpassLastDiagnostics.jsonParsingCompletedElapsedMs,
          jsonParsingDurationMs: overpassLastDiagnostics.jsonParsingDurationMs,
          failurePhase: overpassLastDiagnostics.failurePhase
        }
      };
    }

    if (type === 'wikidata') {
      return {
        configured: true,
        providerName: 'Wikidata Query Service (experimental cafes)',
        status: wikidataConnectionVerified ? 'Connected' : wikidataLastError !== 'None' ? 'Error' : 'Not Tested',
        message: wikidataConnectionVerified
          ? 'A bounded Wikidata cafe query returned business records. Coverage is incomplete.'
          : wikidataLastError !== 'None'
          ? wikidataLastError
          : 'Experimental, cafe-only source. No API key required; run a live test to verify availability.',
        isMock: false,
        endpointStatus: WIKIDATA_ENDPOINT,
        authStatus: 'No API key required',
        lastSuccessfulRequest: wikidataLastSuccessTimestamp,
        lastError: wikidataLastError,
        responseTimeMs: wikidataLastResponseTime,
        isExternal: true
      };
    }

    if (type === 'google_places') {
      const providerName = 'Google Maps Platform Places API (New)';
      const endpointStatus = 'https://places.googleapis.com/v1/places:searchText';

      if (!key) {
        return {
          configured: false,
          providerName,
          status: 'Not Configured',
          message: 'Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY in environment variables.',
          isMock: false,
          endpointStatus,
          authStatus: 'Not Configured',
          lastSuccessfulRequest: lastSuccessTimestamp,
          lastError: lastErrorMsg,
          responseTimeMs: lastResponseTime,
          isExternal: true
        };
      }

      // Distinguish tested connection from untested configuration
      if (connectionVerified) {
        return {
          configured: true,
          providerName,
          status: 'Connected',
          message: 'Google Maps Platform Places API (New) verified and connected.',
          isMock: false,
          endpointStatus,
          authStatus: 'Verified',
          lastSuccessfulRequest: lastSuccessTimestamp,
          lastError: 'None',
          responseTimeMs: lastResponseTime,
          isExternal: true
        };
      }

      if (lastErrorMsg !== 'None') {
        return {
          configured: true,
          providerName,
          status: 'Error',
          message: lastErrorMsg,
          isMock: false,
          endpointStatus,
          authStatus: 'Test Failed',
          lastSuccessfulRequest: lastSuccessTimestamp,
          lastError: lastErrorMsg,
          responseTimeMs: lastResponseTime,
          isExternal: true
        };
      }

      return {
        configured: true,
        providerName,
        status: 'Not Configured',
        message: 'Google Maps API key is configured. Run live connection test to verify.',
        isMock: false,
        endpointStatus,
        authStatus: 'Configured (Untested)',
        lastSuccessfulRequest: lastSuccessTimestamp,
        lastError: lastErrorMsg,
        responseTimeMs: lastResponseTime,
        isExternal: true
      };
    }

    if (type === 'leadocean') {
      const providerName = 'LeadOcean B2B People Search API';
      const endpointStatus = 'https://api.leadocean.io/v1/people/search';

      if (!key) {
        return {
          configured: false,
          providerName,
          status: 'Not Configured',
          message: 'LeadOcean API key is not configured.',
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
        status: connectionVerified ? 'Connected' : 'Not Configured',
        message: connectionVerified
          ? 'LeadOcean provider verified and connected.'
          : 'LeadOcean API key is configured (Untested).',
        isMock: false,
        endpointStatus,
        authStatus: connectionVerified ? 'Verified' : 'Configured (Untested)',
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
      status: connectionVerified ? 'Connected' : 'Not Configured',
      message: connectionVerified
        ? 'Serper.dev Google Search API verified and connected.'
        : 'Serper.dev API key is configured (Untested).',
      isMock: false,
      endpointStatus,
      authStatus: connectionVerified ? 'Verified' : 'Configured (Untested)',
      lastSuccessfulRequest: lastSuccessTimestamp,
      lastError: lastErrorMsg,
      responseTimeMs: lastResponseTime,
      isExternal: true
    };
  }

  /**
   * Executes a real authenticated connection test against Google Maps Places API (New), Serper.dev, or LeadOcean.
   * Returns sanitized diagnostic information without exposing API keys or secrets.
   */
  static async testConnection(
    overrideApiKey?: string,
    requestedType?: string,
    diagnosticContext: NetworkDiagnosticContext = {}
  ): Promise<ProviderDiagnosticTestResult> {
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);
    const startTime = Date.now();

    if (type === 'wikidata') {
      const filters: LeadFilter = {
        jobTitles: [],
        industry: ['cafe'],
        country: 'India',
        city: 'Mumbai',
        seniority: [],
        companySize: [],
        maxLeads: 1
      };
      let networkDiagnostics: NetworkRequestDiagnostics | undefined;
      try {
        const leads = await new WikidataLeadProvider().search(filters, {
          diagnosticContext,
          onDiagnostics: diagnostics => {
            networkDiagnostics = diagnostics;
          }
        });
        const duration = Date.now() - startTime;
        wikidataLastResponseTime = `${duration}ms`;
        if (leads.length === 0) {
          wikidataConnectionVerified = false;
          wikidataLastError = 'Wikidata returned no cafe records for the bounded Mumbai test query.';
          return {
            success: false,
            httpStatus: 503,
            provider: 'Wikidata Query Service (experimental cafes)',
            endpoint: WIKIDATA_ENDPOINT,
            placesReturned: 0,
            responseTime: `${duration}ms`,
            responseTimeMs: duration,
            configured: true,
            status: 'Error',
            authStatus: 'No business data returned',
            message: wikidataLastError,
            sanitizedProviderError: wikidataLastError,
            diagnostics: networkDiagnostics,
            timestamp: new Date().toISOString()
          };
        }
        wikidataConnectionVerified = true;
        wikidataLastSuccessTimestamp = new Date().toISOString();
        wikidataLastError = 'None';
        return {
          success: true,
          httpStatus: 200,
          provider: 'Wikidata Query Service (experimental cafes)',
          endpoint: WIKIDATA_ENDPOINT,
          placesReturned: leads.length,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          configured: true,
          status: 'Connected',
          authStatus: 'No API key required',
          message: `Wikidata returned ${leads.length} cafe record(s) for the bounded Mumbai test query. Coverage is incomplete.`,
          sanitizedProviderError: null,
          diagnostics: networkDiagnostics,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const providerError =
          error instanceof WikidataProviderError
            ? error
            : new WikidataProviderError('Wikidata provider test failed.');
        const diagnostics = providerError.diagnostics || networkDiagnostics;
        wikidataConnectionVerified = false;
        wikidataLastError = providerError.message;
        wikidataLastResponseTime = `${duration}ms`;
        if (diagnostics?.providerId) {
          console.warn('Sanitized Wikidata network diagnostics', JSON.stringify(diagnostics));
        }
        return {
          success: false,
          httpStatus: providerError.timedOut ? 504 : providerError.httpStatus || 502,
          provider: 'Wikidata Query Service (experimental cafes)',
          endpoint: WIKIDATA_ENDPOINT,
          placesReturned: 0,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          configured: true,
          status: 'Error',
          authStatus: 'Public endpoint error',
          message: providerError.message,
          sanitizedProviderError: providerError.message,
          diagnostics,
          timestamp: new Date().toISOString()
        };
      }
    }

    if (type === 'overpass') {
      const healthCheckBudgetMs = getOverpassHealthCheckBudgetMs();
      let healthDiagnostics: OverpassRequestDiagnostics = {};
      try {
        const leads = await new OverpassLeadProvider().search({
          jobTitles: [],
          industry: [],
          country: 'United Kingdom',
          city: 'London',
          seniority: [],
          companySize: [],
          maxLeads: 1
        }, {
          bypassCache: true,
          healthCheck: true,
          maxResults: 1,
          maxAttempts: 1,
          totalBudgetMs: healthCheckBudgetMs,
          diagnosticContext,
          onDiagnostics: diagnostics => {
            healthDiagnostics = diagnostics;
          }
        });
        const duration = Date.now() - startTime;
        overpassLastDiagnostics = healthDiagnostics;
        if (leads.length === 0) {
          overpassConnectionVerified = false;
          overpassLastError = 'Overpass returned no named business data for the bounded health check.';
          overpassLastResponseTime = `${duration}ms`;
          overpassLastDiagnostics = {
            attemptCount: 1,
            elapsedMs: duration,
            upstreamHttpStatus: healthDiagnostics.upstreamHttpStatus ?? 200,
            ...healthDiagnostics
          };
          return {
            success: false,
            httpStatus: 503,
            provider: 'OpenStreetMap Overpass API',
            endpoint: 'https://overpass-api.de/api/interpreter',
            placesReturned: 0,
            responseTime: `${duration}ms`,
            responseTimeMs: duration,
            configured: true,
            status: 'Error',
            authStatus: 'No business data returned',
            message: overpassLastError,
            sanitizedProviderError: overpassLastError,
            timestamp: new Date().toISOString(),
            attemptCount: 1,
            upstreamHttpStatus: 200,
            elapsedMs: duration,
            diagnostics: {
              attemptCount: 1,
              elapsedMs: duration,
              upstreamHttpStatus: healthDiagnostics.upstreamHttpStatus ?? 200,
              ...healthDiagnostics
            }
          };
        }
        overpassConnectionVerified = true;
        overpassLastSuccessTimestamp = new Date().toISOString();
        overpassLastError = 'None';
        overpassLastResponseTime = `${duration}ms`;
        overpassLastDiagnostics = {
          attemptCount: 1,
          elapsedMs: duration,
          upstreamHttpStatus: healthDiagnostics.upstreamHttpStatus ?? 200,
          ...healthDiagnostics
        };
        return {
          success: true,
          httpStatus: 200,
          provider: 'OpenStreetMap Overpass API',
          endpoint: 'https://overpass-api.de/api/interpreter',
          placesReturned: leads.length,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          configured: true,
          status: 'Connected',
          authStatus: 'No API key required',
          message: `Overpass returned ${leads.length} named business result(s) from the bounded central London test query.`,
          sanitizedProviderError: null,
          timestamp: new Date().toISOString(),
          attemptCount: 1,
          upstreamHttpStatus: 200,
          elapsedMs: duration,
          diagnostics: {
            attemptCount: 1,
            elapsedMs: duration,
            upstreamHttpStatus: healthDiagnostics.upstreamHttpStatus ?? 200,
            ...healthDiagnostics
          }
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : 'Overpass connection test failed.';
        const diagnostics =
          error instanceof OverpassApiError
            ? { ...healthDiagnostics, ...error.diagnostics }
            : { attemptCount: 0, elapsedMs: duration };
        const upstreamHttpStatus =
          diagnostics.upstreamHttpStatus ?? (error instanceof OverpassApiError ? error.httpStatus : undefined);
        overpassConnectionVerified = false;
        overpassLastError = message;
        overpassLastResponseTime = `${duration}ms`;
        overpassLastDiagnostics = { ...diagnostics, upstreamHttpStatus };
        if (overpassLastDiagnostics.providerId) {
          console.warn('Sanitized Overpass network diagnostics', JSON.stringify(overpassLastDiagnostics));
        }
        const httpStatus =
          error instanceof OverpassApiError && error.httpStatus
            ? overpassDiagnosticHttpStatus(error.httpStatus)
            : diagnostics.timeoutReason
            ? 504
            : 502;
        return {
          success: false,
          httpStatus,
          provider: 'OpenStreetMap Overpass API',
          endpoint: 'https://overpass-api.de/api/interpreter',
          placesReturned: 0,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          configured: true,
          status: 'Error',
          authStatus: 'Public endpoint error',
          message,
          sanitizedProviderError: message,
          timestamp: new Date().toISOString(),
          attemptCount: diagnostics.attemptCount,
          upstreamHttpStatus,
          elapsedMs: diagnostics.elapsedMs ?? duration,
          timeoutReason: diagnostics.timeoutReason,
          diagnostics: {
            ...diagnostics,
            attemptCount: diagnostics.attemptCount,
            elapsedMs: diagnostics.elapsedMs ?? duration,
            upstreamHttpStatus,
            timeoutReason: diagnostics.timeoutReason,
          }
        };
      }
    }

    if (!key) {
      lastErrorMsg =
        type === 'google_places'
          ? 'Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY in environment variables.'
          : type === 'leadocean'
          ? 'LeadOcean API key is not configured.'
          : 'Serper.dev API key is not configured. Please set SERPER_API_KEY.';
      connectionVerified = false;
      const duration = Date.now() - startTime;

      return {
        success: false,
        httpStatus: 401,
        provider:
          type === 'google_places'
            ? 'Google Maps Platform Places API (New)'
            : type === 'leadocean'
            ? 'LeadOcean B2B People Search API'
            : 'Serper.dev Google Search API',
        endpoint:
          type === 'google_places'
            ? 'https://places.googleapis.com/v1/places:searchText'
            : type === 'leadocean'
            ? 'https://api.leadocean.io/v1/people/search'
            : 'https://google.serper.dev/search',
        placesReturned: 0,
        responseTime: `${duration}ms`,
        responseTimeMs: duration,
        configured: false,
        status: 'Not Configured',
        authStatus: 'Missing Key',
        message: lastErrorMsg,
        sanitizedProviderError: 'API key is missing or blank',
        timestamp: new Date().toISOString()
      };
    }

    if (type === 'google_places') {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': googlePlacesTestRequest.headers.fieldMask
          },
          body: JSON.stringify(googlePlacesTestRequest.body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        lastResponseTime = `${duration}ms`;
        const httpStatus = response.status;

        if (response.ok) {
          const data = await response.json();
          const places = Array.isArray(data.places) ? data.places : [];
          lastSuccessTimestamp = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          lastErrorMsg = 'None';
          connectionVerified = true;

          return {
            success: true,
            httpStatus: 200,
            provider: 'Google Maps Platform Places API (New)',
            endpoint: 'https://places.googleapis.com/v1/places:searchText',
            placesReturned: places.length,
            responseTime: `${duration}ms`,
            responseTimeMs: duration,
            configured: true,
            status: 'Connected',
            authStatus: 'Verified',
            message: `Google Maps Platform Places API (New) connected successfully. Verified ${places.length} real places returned.`,
            sanitizedProviderError: null,
            timestamp: new Date().toISOString(),
            diagnostics: {
              apiKeyDetected: true,
              providerInitialized: true,
              httpStatusCode: 200,
              placesReturned: places.length,
              credentialSource: 'GOOGLE_MAPS_API_KEY',
              request: googlePlacesTestRequest
            }
          };
        }

        // Sanitized error handling for all HTTP statuses
        connectionVerified = false;
        const errorBody = await response.text();
        const googleFailure = diagnoseGooglePlacesFailure(errorBody, httpStatus, key);
        const rawStatus = googleFailure.googleError.status || '';
        const rawMessage = googleFailure.googleError.message;

        let sanitizedError = `Google Places API returned HTTP ${httpStatus}`;

        if (httpStatus === 400) {
          sanitizedError = `Malformed request to Google Places API (HTTP 400). ${rawMessage}`;
        } else if (httpStatus === 401) {
          sanitizedError = `Unauthorized Google Maps API Key (HTTP 401). ${rawMessage}`;
        } else if (httpStatus === 403) {
          sanitizedError = googleFailure.permissionDiagnosis.action;
        } else if (httpStatus === 429) {
          sanitizedError = `Google Maps Places API rate limit or quota exceeded (HTTP 429). ${rawMessage}`;
        } else if (httpStatus >= 500) {
          sanitizedError = `Google Maps upstream server error (HTTP ${httpStatus}). ${rawMessage}`;
        }

        lastErrorMsg = sanitizedError;

        return {
          success: false,
          httpStatus,
          provider: 'Google Maps Platform Places API (New)',
          endpoint: 'https://places.googleapis.com/v1/places:searchText',
          placesReturned: 0,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          configured: true,
          status: 'Error',
          authStatus: googleAuthStatus(googleFailure.permissionDiagnosis.category),
          message: sanitizedError,
          sanitizedProviderError: sanitizedError,
          timestamp: new Date().toISOString(),
          diagnostics: {
            apiKeyDetected: true,
            providerInitialized: true,
            httpStatusCode: httpStatus,
            providerErrorMessage: sanitizedError,
            googleErrorMessage: rawStatus || `HTTP_${httpStatus}`,
            credentialSource: 'GOOGLE_MAPS_API_KEY',
            request: googlePlacesTestRequest,
            googleError: googleFailure.googleError,
            permissionDiagnosis: googleFailure.permissionDiagnosis
          }
        };
      } catch (err: any) {
        connectionVerified = false;
        const duration = Date.now() - startTime;
        const isTimeout = err.name === 'AbortError';
        const sanitizedError = isTimeout
          ? 'Network timeout (10s limit) connecting to Google Places API.'
          : 'Network error connecting to Google Maps Places API endpoint.';
        lastErrorMsg = sanitizedError;

        return {
          success: false,
          httpStatus: isTimeout ? 504 : 502,
          provider: 'Google Maps Platform Places API (New)',
          endpoint: 'https://places.googleapis.com/v1/places:searchText',
          placesReturned: 0,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          configured: true,
          status: 'Error',
          authStatus: 'Network Error',
          message: sanitizedError,
          sanitizedProviderError: sanitizedError,
          timestamp: new Date().toISOString(),
          diagnostics: {
            apiKeyDetected: true,
            providerInitialized: true,
            httpStatusCode: isTimeout ? 504 : 502,
            providerErrorMessage: sanitizedError,
            credentialSource: 'GOOGLE_MAPS_API_KEY',
            request: googlePlacesTestRequest
          }
        };
      }
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
            q: 'software companies in Mumbai, India',
            num: 2
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        lastResponseTime = `${duration}ms`;

        if (response.ok) {
          lastSuccessTimestamp = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          lastErrorMsg = 'None';
          connectionVerified = true;
          return {
            success: true,
            httpStatus: 200,
            provider: 'Serper.dev Google Search API',
            endpoint: 'https://google.serper.dev/search',
            placesReturned: 2,
            responseTime: `${duration}ms`,
            responseTimeMs: duration,
            configured: true,
            status: 'Connected',
            authStatus: 'Verified',
            message: 'Serper.dev Google Search API connected successfully.',
            sanitizedProviderError: null,
            timestamp: new Date().toISOString()
          };
        }

        const httpCode = response.status;
        connectionVerified = false;
        const errJson = await response.json().catch(() => null);
        const rawMsg = errJson?.message || `Serper.dev API returned HTTP ${httpCode}`;
        lastErrorMsg = String(rawMsg);

        return {
          success: false,
          httpStatus: httpCode,
          provider: 'Serper.dev Google Search API',
          endpoint: 'https://google.serper.dev/search',
          placesReturned: 0,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          configured: true,
          status: 'Error',
          authStatus: 'Authentication Error',
          message: lastErrorMsg,
          sanitizedProviderError: lastErrorMsg,
          timestamp: new Date().toISOString()
        };
      } catch (err: any) {
        connectionVerified = false;
        const duration = Date.now() - startTime;
        lastErrorMsg = err.message || 'Network error connecting to Serper.dev';
        return {
          success: false,
          httpStatus: 502,
          provider: 'Serper.dev Google Search API',
          endpoint: 'https://google.serper.dev/search',
          placesReturned: 0,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          configured: true,
          status: 'Error',
          authStatus: 'Network Error',
          message: lastErrorMsg,
          sanitizedProviderError: lastErrorMsg,
          timestamp: new Date().toISOString()
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
        lastSuccessTimestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        lastErrorMsg = 'None';
        connectionVerified = true;
        return {
          success: true,
          httpStatus: 200,
          provider: 'LeadOcean B2B People Search API',
          endpoint,
          placesReturned: 1,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          configured: true,
          status: 'Connected',
          authStatus: 'Verified',
          message: 'LeadOcean provider connected successfully.',
          sanitizedProviderError: null,
          timestamp: new Date().toISOString()
        };
      }

      const httpCode = response ? response.status : 500;
      connectionVerified = false;
      const errJson = await response?.json().catch(() => null);
      const rawMsg = errJson?.message || `LeadOcean API returned HTTP ${httpCode}`;
      lastErrorMsg = String(rawMsg);

      return {
        success: false,
        httpStatus: httpCode,
        provider: 'LeadOcean B2B People Search API',
        endpoint,
        placesReturned: 0,
        responseTime: `${duration}ms`,
        responseTimeMs: duration,
        configured: true,
        status: 'Error',
        authStatus: 'Authentication Error',
        message: lastErrorMsg,
        sanitizedProviderError: lastErrorMsg,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      connectionVerified = false;
      const duration = Date.now() - startTime;
      lastErrorMsg = err.message || 'Invalid API Credentials or Network Error';
      return {
        success: false,
        httpStatus: 502,
        provider: 'LeadOcean B2B People Search API',
        endpoint: 'https://api.leadocean.io/v1/people/search',
        placesReturned: 0,
        responseTime: `${duration}ms`,
        responseTimeMs: duration,
        configured: true,
        status: 'Error',
        authStatus: 'Network Error',
        message: lastErrorMsg,
        sanitizedProviderError: lastErrorMsg,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Fetches candidate leads using Google Maps Places API (New) or fallback providers.
   */
  static async fetchCandidateLeads(
    filters: LeadFilter,
    overrideApiKey?: string,
    requestedType?: string
  ): Promise<RawLead[]> {
    const startTime = Date.now();
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);

    if (type === 'overpass') {
      try {
        const results = await new OverpassLeadProvider().search(filters);
        const elapsedMs = Date.now() - startTime;
        if (results.length === 0) {
          overpassConnectionVerified = false;
          overpassLastError = 'Overpass search returned no named business results.';
          overpassLastResponseTime = `${elapsedMs}ms`;
          overpassLastDiagnostics = { elapsedMs };
        }
        return results;
      } catch (err) {
        overpassConnectionVerified = false;
        overpassLastError = err instanceof Error ? err.message : 'OpenStreetMap Overpass search error.';
        overpassLastResponseTime = `${Date.now() - startTime}ms`;
        overpassLastDiagnostics =
          err instanceof OverpassApiError
            ? {
                ...err.diagnostics,
                upstreamHttpStatus: err.diagnostics.upstreamHttpStatus ?? err.httpStatus
              }
            : { elapsedMs: Date.now() - startTime };
        throw err;
      }
    }

    if (type === 'wikidata') {
      try {
        const results = await new WikidataLeadProvider().search(filters);
        wikidataConnectionVerified = results.length > 0;
        wikidataLastError = results.length > 0
          ? 'None'
          : 'Wikidata returned no cafe records for this search.';
        wikidataLastResponseTime = `${Date.now() - startTime}ms`;
        if (results.length > 0) wikidataLastSuccessTimestamp = new Date().toISOString();
        return results;
      } catch (error) {
        wikidataConnectionVerified = false;
        wikidataLastError = error instanceof Error ? error.message : 'Wikidata provider search error.';
        wikidataLastResponseTime = `${Date.now() - startTime}ms`;
        throw error;
      }
    }

    if (!key) {
      lastErrorMsg =
        type === 'google_places'
          ? 'Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY or VITE_GOOGLE_MAPS_API_KEY.'
          : type === 'leadocean'
          ? 'LeadOcean API key is not configured.'
          : 'Serper.dev API key is not configured. Please set SERPER_API_KEY.';
      throw new Error(lastErrorMsg);
    }

    if (type === 'google_places') {
      const provider = new GoogleMapsPlacesLeadProvider(key);
      try {
        const results = await provider.search(filters);
        lastSuccessTimestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        lastErrorMsg = 'None';
        lastResponseTime = `${Date.now() - startTime}ms`;
        connectionVerified = true;
        return results;
      } catch (err: any) {
        lastErrorMsg = err.message || 'Google Maps Places API search error.';
        throw err;
      }
    }

    if (type === 'serper') {
      const provider = new SerperSearchLeadProvider(key);
      try {
        const results = await provider.search(filters);
        lastSuccessTimestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
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
      lastSuccessTimestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
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
