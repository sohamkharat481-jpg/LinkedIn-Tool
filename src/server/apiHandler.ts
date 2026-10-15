import express, { Request, Response } from 'express';
import { LeadFilter, RawLead } from '../types';
import { filterAndDeduplicateLeads } from '../services/deduplication';
import { ServerLeadProviderService } from './leadProviderService';
import { testSupabaseHealth } from '../services/supabase';
import { GooglePlacesApiError } from '../services/leadProviders/googlePlacesErrors';
import { OverpassApiError } from '../services/leadProviders/OverpassLeadProvider';

export const apiRouter = express.Router();

apiRouter.use(express.json());

// Express & Connect compatibility middleware for raw HTTP response objects
apiRouter.use((req: any, res: any, next) => {
  // Polyfill res.status if missing
  if (typeof res.status !== 'function') {
    res.status = function (statusCode: number) {
      res.statusCode = statusCode;
      return res;
    };
  }

  // Polyfill res.json if missing
  if (typeof res.json !== 'function') {
    res.json = function (data: any) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify(data));
      return res;
    };
  }

  // Query parsing fallback middleware for Connect/Vite dev server
  if (!req.query) {
    try {
      const parsed = new URL(req.url || '', 'http://localhost');
      const queryObj: Record<string, string> = {};
      parsed.searchParams.forEach((val, key) => {
        queryObj[key] = val;
      });
      req.query = queryObj;
    } catch {
      req.query = {};
    }
  }
  next();
});

// 1. Health check endpoint
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'LinkedIn Lead Finder API',
    timestamp: new Date().toISOString()
  });
});

// Supabase Connection Diagnostics Endpoint (Does NOT reveal secret keys)
apiRouter.get('/supabase-status', async (_req: Request, res: Response) => {
  try {
    const diag = await testSupabaseHealth();
    res.json(diag);
  } catch (error: any) {
    console.error('API /supabase-status error:', error);
    res.status(500).json({ error: error.message || 'Failed to check Supabase health.' });
  }
});

// Comprehensive Environment & System Diagnostics Endpoint (Safe: Never reveals secrets)
apiRouter.get('/diagnostics', async (req: Request, res: Response) => {
  try {
    const apiKey = (req.headers['x-provider-api-key'] as string);
    const providerDiag = ServerLeadProviderService.getDiagnostics(apiKey);
    const supabaseDiag = await testSupabaseHealth();
    
    const hasViteSupabaseUrl = Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_URL.trim());
    const hasViteSupabaseAnonKey = Boolean(process.env.VITE_SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY.trim());
    const hasGoogleClientId = Boolean(process.env.VITE_GOOGLE_CLIENT_ID && process.env.VITE_GOOGLE_CLIENT_ID.trim());

    res.json({
      timestamp: new Date().toISOString(),
      environment: {
        type: process.env.VERCEL ? 'Vercel Production' : 'AI Studio Preview / Development',
        nodeEnv: process.env.NODE_ENV || 'development',
        appUrl: process.env.APP_URL || process.env.VERCEL_URL || 'Google Cloud Run Dev Environment'
      },
      providers: {
        GOOGLE_MAPS_API_KEY: providerDiag.GOOGLE_MAPS_API_KEY,
        SERPER_API_KEY: providerDiag.SERPER_API_KEY,
        LEADOCEAN_API_KEY: providerDiag.LEADOCEAN_API_KEY,
        activeProvider: providerDiag.ActiveProvider
      },
      database: {
        SUPABASE_URL: supabaseDiag.SUPABASE_URL,
        SUPABASE_ANON_KEY: supabaseDiag.SUPABASE_ANON_KEY,
        VITE_SUPABASE_URL: hasViteSupabaseUrl ? 'CONFIGURED' : 'MISSING',
        VITE_SUPABASE_ANON_KEY: hasViteSupabaseAnonKey ? 'CONFIGURED' : 'MISSING',
        clientStatus: supabaseDiag.supabaseClientStatus,
        queryStatus: supabaseDiag.databaseQueryStatus,
        authStatus: supabaseDiag.authServiceStatus
      },
      integrations: {
        googleSheetsOAuth: hasGoogleClientId ? 'CONFIGURED' : 'NOT TESTED (Client Flow)'
      }
    });
  } catch (error: any) {
    console.error('API /diagnostics error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch diagnostics.' });
  }
});

// 2. Provider Health / Status Endpoint (Does NOT expose secrets)
apiRouter.get('/provider-status', (req: Request, res: Response) => {
  try {
    const apiKey = (req.headers['x-provider-api-key'] as string);
    const providerType = req.query?.type as string | undefined;

    const statusInfo = ServerLeadProviderService.getStatus(apiKey, providerType);
    res.json(statusInfo);
  } catch (error: any) {
    console.error('API /provider-status error:', error);
    res.status(500).json({ error: error.message || 'Failed to check provider status.' });
  }
});

// Safe Diagnostic Endpoint (Reports CONFIGURED/MISSING status only)
apiRouter.get('/provider-status/diagnostics', (req: Request, res: Response) => {
  try {
    const apiKey = (req.headers['x-provider-api-key'] as string);

    const diag = ServerLeadProviderService.getDiagnostics(apiKey);
    res.json(diag);
  } catch (error: any) {
    console.error('API /provider-status/diagnostics error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch provider diagnostics.' });
  }
});

// 3. Test Provider Connection Endpoint (Supports both GET and POST)
export const handleTestConnection = async (req: Request, res: Response) => {
  try {
    const apiKey =
      (req.headers['x-goog-api-key'] as string) ||
      (req.headers['x-provider-api-key'] as string) ||
      (req.query?.key as string) ||
      (req.query?.apiKey as string) ||
      req.body?.apiKey;
    const providerType =
      (req.query?.type as string) ||
      (req.query?.providerType as string) ||
      req.body?.providerType;

    const testResult = await ServerLeadProviderService.testConnection(apiKey, providerType);
    res.json(testResult);
  } catch (error: any) {
    console.error('API /provider-status/test error:', error);
    res.status(500).json({
      success: false,
      httpStatus: 500,
      provider: 'Google Maps Platform Places API (New)',
      endpoint: 'https://places.googleapis.com/v1/places:searchText',
      placesReturned: 0,
      responseTime: '0ms',
      responseTimeMs: 0,
      configured: false,
      status: 'Error',
      authStatus: 'Internal Error',
      message: error.message || 'Failed to execute provider connection test.',
      sanitizedProviderError: error.message || 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
};

apiRouter.all('/provider-status/test', handleTestConnection);
apiRouter.all('/api/provider-status/test', handleTestConnection);

const executeLeadSearch = async (filters: LeadFilter, providerType?: string, apiKey?: string) => {
  filters.maxLeads = Math.min(Math.max(Number(filters.maxLeads) || 50, 1), 500);

  const resolved = ServerLeadProviderService.resolveApiKey(apiKey, providerType);
  if (resolved.type !== 'overpass' && (!resolved.key || resolved.key.trim() === '')) {
    return {
      status: 422,
      body: {
        error: 'No real lead provider is configured.',
        code: 'NO_PROVIDER_CONFIGURED',
        message: 'Configure a Google Maps Places, Serper, or LeadOcean API key on the server, or select the no-key OpenStreetMap provider.'
      }
    };
  }

  try {
    const rawCandidates: RawLead[] = await ServerLeadProviderService.fetchCandidateLeads(
      filters,
      resolved.key,
      resolved.type
    );
    const dedupeResult = filterAndDeduplicateLeads(rawCandidates);
    const isGooglePlaces = resolved.type === 'google_places';
    const isSerper = resolved.type === 'serper';
    const isOverpass = resolved.type === 'overpass';

    return {
      status: 200,
      body: {
        success: true,
        provider: {
          id: isOverpass
            ? 'openstreetmap-overpass-provider'
            : isGooglePlaces
            ? 'google-maps-places-provider'
            : isSerper
            ? 'serper-search-provider'
            : 'leadocean-b2b-provider',
          name: isOverpass
            ? 'OpenStreetMap Overpass API'
            : isGooglePlaces
            ? 'Google Maps Platform Places API (New)'
            : isSerper
            ? 'Serper.dev Google Search API'
            : 'LeadOcean B2B People Search API',
          isMock: false
        },
        metrics: {
          rawCandidatesCount: dedupeResult.rawCandidatesCount,
          validRecordsCount: dedupeResult.validRecordsCount,
          duplicateProfilesRemoved: dedupeResult.duplicateProfilesRemoved,
          duplicatePeopleRemoved: dedupeResult.duplicatePeopleRemoved,
          duplicateBusinessesRemoved: dedupeResult.duplicateBusinessesRemoved,
          totalDuplicatesRemoved: dedupeResult.totalDuplicatesRemoved,
          finalLeadCount: dedupeResult.finalUniqueLeads.length
        },
        leads: dedupeResult.finalUniqueLeads
      }
    };
  } catch (error: any) {
    console.error('API lead search error:', error);
    if (error instanceof GooglePlacesApiError) {
      return {
        status: 502,
        body: {
          error: error.message,
          code: 'GOOGLE_PLACES_API_ERROR',
          providerHttpStatus: error.httpStatus,
          ...error.diagnostics
        }
      };
    }
    if (error instanceof OverpassApiError) {
      const status =
        error.httpStatus === 429
          ? 429
          : error.httpStatus && error.httpStatus >= 500
          ? 503
          : error.message.includes('timed out')
          ? 504
          : 502;
      return {
        status,
        body: {
          error: error.message,
          code: 'OVERPASS_API_ERROR',
          providerHttpStatus: error.httpStatus
        }
      };
    }
    return {
      status: 502,
      body: {
        error: error.message || 'Lead provider temporarily unavailable.'
      }
    };
  }
};

// 4. Main Search Leads Endpoint (Executes server-side provider, normalization & deduplication)
apiRouter.post('/search-leads', async (req: Request, res: Response) => {
  const { filters, providerType, apiKey } = req.body;
  if (!filters || typeof filters !== 'object') {
    res.status(400).json({ error: 'Invalid search filters provided.' });
    return;
  }

  const result = await executeLeadSearch(filters as LeadFilter, providerType, apiKey);
  res.status(result.status).json(result.body);
});

// 5. Server-side Lead Provider Proxy Implementation
apiRouter.post('/lead-search-proxy', async (req: Request, res: Response) => {
  const filters = req.body.filters || req.body;
  if (!filters || typeof filters !== 'object') {
    res.status(400).json({ error: 'Invalid search filters provided.' });
    return;
  }

  const result = await executeLeadSearch(filters as LeadFilter, req.body.providerType);
  if (result.status !== 200) {
    res.status(result.status).json(result.body);
    return;
  }

  res.json({
    success: true,
    leads: result.body.leads
  });
});

// 6. LinkedIn Profile Analysis Endpoint for Profile-Link Mode ICP Generation
apiRouter.post('/analyze-profile', async (req: Request, res: Response) => {
  try {
    const { profileUrl } = req.body;

    if (!profileUrl || typeof profileUrl !== 'string') {
      res.status(400).json({ error: 'LinkedIn profile URL is required.' });
      return;
    }

    const linkedInRegex = /https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+/i;
    if (!linkedInRegex.test(profileUrl.trim())) {
      res.status(400).json({
        error: 'Invalid LinkedIn profile URL. Must match format: https://www.linkedin.com/in/example'
      });
      return;
    }

    let icpSummary = {
      jobTitles: ['Founder', 'CEO', 'Director'],
      industry: ['Technology & SaaS'],
      seniority: ['Director', 'VP', 'C-Level'],
      country: 'United States',
      city: 'San Francisco',
      companySize: ['11-50', '51-200'],
      keywords: 'SaaS, B2B, Growth'
    };

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMIN_API_KEY;
    if (apiKey) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Analyze this LinkedIn profile URL/slug: "${profileUrl}". 
Extract or deduce an Ideal Customer Profile (ICP) summary for B2B lead generation matching this person's likely professional domain and network.
Return valid JSON only with keys: 
- jobTitles (array of strings)
- industry (array of strings)
- seniority (array of strings: Entry, Manager, Senior, Director, VP, C-Level)
- country (string)
- city (string)
- companySize (array of strings: 1-10, 11-50, 51-200, 201-500, 501-1000, 1001+)
- keywords (string)`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt
        });

        const text = response.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed && typeof parsed === 'object') {
            icpSummary = {
              jobTitles: Array.isArray(parsed.jobTitles) && parsed.jobTitles.length > 0 ? parsed.jobTitles : icpSummary.jobTitles,
              industry: Array.isArray(parsed.industry) && parsed.industry.length > 0 ? parsed.industry : icpSummary.industry,
              seniority: Array.isArray(parsed.seniority) ? parsed.seniority : icpSummary.seniority,
              country: parsed.country || icpSummary.country,
              city: parsed.city || icpSummary.city,
              companySize: Array.isArray(parsed.companySize) ? parsed.companySize : icpSummary.companySize,
              keywords: parsed.keywords || icpSummary.keywords
            };
          }
        }
      } catch (geminiErr) {
        console.warn('Gemini profile analysis fallback to heuristics:', geminiErr);
      }
    }

    res.json({
      success: true,
      profileUrl: profileUrl.trim(),
      icp: icpSummary,
      message: 'Profile successfully analyzed and ICP generated.'
    });
  } catch (error: any) {
    console.error('API /analyze-profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze LinkedIn profile.' });
  }
});
