import { LeadFilter, RawLead, ProviderStatusInfo } from '../types';
import { GoogleMapsPlacesLeadProvider } from '../services/leadProviders/GoogleMapsPlacesLeadProvider';
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
    const cleanedOverride =
      overrideApiKey &&
      typeof overrideApiKey === 'string' &&
      overrideApiKey.trim() !== '' &&
      overrideApiKey !== 'undefined' &&
      overrideApiKey !== 'null'
        ? overrideApiKey.trim()
        : '';

    const googleMapsKey =
      cleanedOverride ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.PLACES_API_KEY;

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
        : hasSerper
        ? 'Serper.dev Google Search API'
        : hasLeadOcean
        ? 'LeadOcean B2B People Search API'
        : 'None (Unconfigured)',
      Runtime: runtimeName,
      Deployment: deploymentId,
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
  ): { key: string; type: 'google_places' | 'serper' | 'leadocean' } {
    const cleanedOverride =
      overrideKey &&
      typeof overrideKey === 'string' &&
      overrideKey.trim() !== '' &&
      overrideKey !== 'undefined' &&
      overrideKey !== 'null'
        ? overrideKey.trim()
        : '';

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
    const googleMapsKey = (
      cleanedOverride ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.PLACES_API_KEY ||
      ''
    ).trim();

    if (googleMapsKey) {
      return { key: googleMapsKey, type: 'google_places' };
    }

    // Fallback to Serper.dev if Google Maps not configured
    const serperKey = (
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

    return { key: '', type: 'google_places' };
  }

  /**
   * Evaluates current provider status without exposing secrets.
   */
  static getStatus(overrideApiKey?: string, requestedType?: string): ProviderStatusInfo {
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);

    if (type === 'google_places') {
      const providerName = 'Google Maps Platform Places API (New)';
      const endpointStatus = 'https://places.googleapis.com/v1/places:searchText';

      if (!key) {
        return {
          configured: false,
          providerName,
          status: 'Not Configured',
          message: 'Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY or VITE_GOOGLE_MAPS_API_KEY.',
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
        message: 'Google Maps Platform Places API (New) configured and ready.',
        isMock: false,
        endpointStatus,
        authStatus: 'Configured',
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
        status: connectionVerified ? 'Connected' : 'Connected',
        message: 'LeadOcean provider configured.',
        isMock: false,
        endpointStatus,
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
   * Executes a real authenticated connection test against Google Maps Places API (New), Serper.dev, or LeadOcean.
   */
  static async testConnection(overrideApiKey?: string, requestedType?: string): Promise<ProviderStatusInfo> {
    const { key, type } = this.resolveApiKey(overrideApiKey, requestedType);
    const startTime = Date.now();

    if (!key) {
      lastErrorMsg =
        type === 'google_places'
          ? 'Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY or VITE_GOOGLE_MAPS_API_KEY.'
          : type === 'leadocean'
          ? 'LeadOcean API key is not configured.'
          : 'Serper.dev API key is not configured. Please set SERPER_API_KEY.';
      connectionVerified = false;
      return this.getStatus(overrideApiKey, requestedType);
    }

    if (type === 'google_places') {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'places.id,places.displayName',
            'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio'
          },
          body: JSON.stringify({
            textQuery: 'test',
            pageSize: 1
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
            ...this.getStatus(key, 'google_places'),
            status: 'Connected',
            message: 'Google Maps Platform Places API (New) connected successfully.'
          };
        }

        const httpCode = response.status;
        connectionVerified = false;
        const errJson = await response.json().catch(() => null);
        let rawMsg = errJson?.error?.message || `Google Places API returned HTTP ${httpCode}`;

        if (httpCode === 403) {
          if (rawMsg.includes('caller does not have permission') || rawMsg.includes('PERMISSION_DENIED')) {
            rawMsg =
              'Google Maps Places API (New) permission denied. Ensure "Places API (New)" is enabled in your Google Cloud Console and billing is active for this API key.';
          } else if (rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('not valid')) {
            rawMsg = 'Invalid Google Maps API Key. Please verify GOOGLE_MAPS_API_KEY.';
          }
        }

        lastErrorMsg = String(rawMsg);

        return {
          ...this.getStatus(key, 'google_places'),
          status: 'Error',
          message: lastErrorMsg,
          diagnostics: {
            apiKeyDetected: true,
            providerInitialized: true,
            httpStatusCode: httpCode,
            providerErrorMessage: lastErrorMsg,
            googleErrorMessage: errJson?.error?.status || `HTTP_${httpCode}`
          }
        };
      } catch (err: any) {
        connectionVerified = false;
        lastErrorMsg = err.message || 'Network error connecting to Google Maps Places API';
        return {
          ...this.getStatus(key, 'google_places'),
          status: 'Error',
          message: lastErrorMsg
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
            q: 'test',
            num: 1
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
        lastSuccessTimestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
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
   * Fetches candidate leads using Google Maps Places API (New) or fallback providers.
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
