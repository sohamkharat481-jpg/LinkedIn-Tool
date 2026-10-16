import express, { Request, Response } from 'express';
import { LeadFilter, RawLead } from '../types';
import { filterAndDeduplicateLeads } from '../services/deduplication';
import { ServerLeadProviderService } from './leadProviderService';
import { testSupabaseHealth } from '../services/supabase';
import { InstagramBusinessProviderError } from '../services/leadProviders/InstagramBusinessLeadProvider';
import { InstagramOAuthService } from './instagramOAuthService';
import { verifyServerAuthToken } from './serverAuthService';

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
        SERPER_API_KEY: providerDiag.SERPER_API_KEY,
        LEADOCEAN_API_KEY: providerDiag.LEADOCEAN_API_KEY,
        INSTAGRAM_ACCESS_TOKEN: providerDiag.INSTAGRAM_ACCESS_TOKEN,
        INSTAGRAM_USER_ID: providerDiag.INSTAGRAM_USER_ID,
        INSTAGRAM_GRAPH_API_VERSION: providerDiag.INSTAGRAM_GRAPH_API_VERSION,
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
    const unsupportedProvider =
      error instanceof Error && error.message.startsWith('Unsupported lead provider:');
    res.status(unsupportedProvider ? 400 : 500).json({
      error: error.message || 'Failed to check provider status.'
    });
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
      (req.headers['x-provider-api-key'] as string) ||
      (req.query?.key as string) ||
      (req.query?.apiKey as string) ||
      req.body?.apiKey;
    const providerType =
      (req.query?.type as string) ||
      (req.query?.providerType as string) ||
      req.body?.providerType;
    const workspaceId = (req.query?.workspaceId as string) || req.body?.workspaceId;
    const clientId = (req.query?.clientId as string) || req.body?.clientId;

    const testResult = await ServerLeadProviderService.testConnection(apiKey, providerType, workspaceId, clientId);
    const responseStatus =
      testResult.success
        ? 200
        : testResult.httpStatus >= 400 && testResult.httpStatus <= 599
        ? testResult.httpStatus
        : 502;
    res.status(responseStatus).json(testResult);
  } catch (error: any) {
    console.error('API /provider-status/test error:', error);
    const unsupportedProvider =
      error instanceof Error && error.message.startsWith('Unsupported lead provider:');
    res.status(unsupportedProvider ? 400 : 500).json({
      success: false,
      httpStatus: unsupportedProvider ? 400 : 500,
      provider: 'Selected lead provider',
      endpoint: 'Not available',
      endpointStatus: 'Not available',
      placesReturned: 0,
      responseTime: '0ms',
      responseTimeMs: 0,
      configured: false,
      status: 'Error',
      authStatus: 'Internal Error',
      message: error.message || 'Failed to execute provider connection test.',
      sanitizedProviderError: error.message || 'Internal server error',
      isMock: false,
      lastSuccessfulRequest: 'None yet',
      lastError: error.message || 'Internal server error',
      isExternal: true,
      timestamp: new Date().toISOString()
    });
  }
};

apiRouter.all('/provider-status/test', handleTestConnection);
apiRouter.all('/api/provider-status/test', handleTestConnection);

const executeLeadSearch = async (
  filters: LeadFilter,
  providerType?: string,
  apiKey?: string,
  reqWorkspaceId?: string,
  reqClientId?: string,
  req?: Request | any
) => {
  filters.maxLeads = Math.min(Math.max(Number(filters.maxLeads) || 50, 1), 500);

  const workspaceId = reqWorkspaceId || 'ws-default-01';
  const clientId = reqClientId;

  let resolved: ReturnType<typeof ServerLeadProviderService.resolveApiKey>;
  try {
    resolved = ServerLeadProviderService.resolveApiKey(apiKey, providerType);
  } catch (error) {
    return {
      status: 400,
      body: {
        error: error instanceof Error ? error.message : 'Unsupported lead provider.'
      }
    };
  }

  if (
    !resolved.key &&
    !(resolved.type === 'instagram_business' && clientId) &&
    !process.env.INSTAGRAM_ACCESS_TOKEN?.trim()
  ) {
    return {
      status: 422,
      body: {
        error:
          resolved.type === 'instagram_business'
            ? 'Instagram Business Discovery requires a connected Instagram account or server-side credentials.'
            : 'No API key is configured for the selected lead provider.',
        code: 'NO_PROVIDER_CONFIGURED'
      }
    };
  }

  if (resolved.type === 'instagram_business' && clientId) {
    const authResult = await verifyServerAuthToken(req || { headers: {} });
    if (!authResult.user) {
      return {
        status: authResult.status || 401,
        body: {
          error: authResult.error || 'Authentication required to access client Instagram credentials.'
        }
      };
    }
    const isAuthorized = await InstagramOAuthService.verifyClientAuthorization(
      workspaceId,
      clientId.trim(),
      authResult.user.userId
    );
    if (!isAuthorized) {
      return {
        status: 403,
        body: {
          error: 'Unauthorized: Requester is not permitted to access this client integration.'
        }
      };
    }
  }

  try {
    const rawCandidates: RawLead[] = await ServerLeadProviderService.fetchCandidateLeads(
      filters,
      resolved.key,
      resolved.type,
      workspaceId,
      clientId
    );
    const dedupeResult = filterAndDeduplicateLeads(rawCandidates);
    const isSerper = resolved.type === 'serper';
    const isInstagramBusiness = resolved.type === 'instagram_business';

    return {
      status: 200,
      body: {
        success: true,
        provider: {
          id: isInstagramBusiness
            ? 'instagram-business-discovery-provider'
            : isSerper
            ? 'serper-search-provider'
            : 'leadocean-b2b-provider',
          name: isInstagramBusiness
            ? 'Instagram Graph API Business Discovery'
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
    if (!(error instanceof InstagramBusinessProviderError)) {
      console.error('API lead search error:', error);
    }
    if (error instanceof InstagramBusinessProviderError) {
      return {
        status: error.httpStatus,
        body: {
          error: error.message,
          code: 'INSTAGRAM_BUSINESS_DISCOVERY_ERROR'
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
  const { filters, providerType, apiKey, workspaceId, clientId } = req.body;
  if (!filters || typeof filters !== 'object') {
    res.status(400).json({ error: 'Invalid search filters provided.' });
    return;
  }

  const result = await executeLeadSearch(filters as LeadFilter, providerType, apiKey, workspaceId, clientId, req);
  res.status(result.status).json(result.body);
});

// 5. Server-side Lead Provider Proxy Implementation
apiRouter.post('/lead-search-proxy', async (req: Request, res: Response) => {
  const filters = req.body.filters || req.body;
  const workspaceId = req.body.workspaceId;
  const clientId = req.body.clientId;
  if (!filters || typeof filters !== 'object') {
    res.status(400).json({ error: 'Invalid search filters provided.' });
    return;
  }

  const result = await executeLeadSearch(filters as LeadFilter, req.body.providerType, undefined, workspaceId, clientId, req);
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

// Instagram Client-Specific OAuth & Integration Endpoints

// Instagram Client-Specific OAuth & Integration Endpoints

function escapeHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

apiRouter.get('/auth/instagram/start', async (req: Request, res: Response) => {
  const authResult = await verifyServerAuthToken(req);
  if (!authResult.user) {
    res.status(authResult.status || 401).json({ error: authResult.error || 'Authentication required.' });
    return;
  }
  const verifiedUserId = authResult.user.userId;

  const workspaceId = (req.query.workspaceId as string) || 'ws-default-01';
  const clientId = req.query.clientId as string;

  if (!clientId || typeof clientId !== 'string' || clientId.trim() === '') {
    res.status(400).json({ error: 'clientId is required to start Instagram OAuth.' });
    return;
  }

  // Enforce authorized workspace and client ownership using verified user identity
  const isAuthorized = await InstagramOAuthService.verifyClientAuthorization(
    workspaceId,
    clientId.trim(),
    verifiedUserId
  );
  if (!isAuthorized) {
    res.status(403).json({ error: 'Unauthorized: Client does not belong to the workspace or requester is not permitted.' });
    return;
  }

  const appId = process.env.META_APP_ID || process.env.VITE_META_APP_ID;
  if (!appId) {
    res.status(503).json({ error: 'META_APP_ID is not configured on the server.' });
    return;
  }

  const redirectUri =
    process.env.META_OAUTH_REDIRECT_URI ||
    `${req.protocol}://${req.get('host')}/api/auth/instagram/callback`;
  const state = InstagramOAuthService.createState(workspaceId, clientId.trim(), verifiedUserId);
  const graphVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || 'v25.0';

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement',
    state
  });

  const authUrl = `https://www.facebook.com/${graphVersion}/dialog/oauth?${params.toString()}`;
  res.json({ url: authUrl });
});

const handleInstagramCallback = async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    const safeError = escapeHtml(error_description || error);
    res.status(400).send(`<!DOCTYPE html><html><body><h3>Instagram Authorization Failed</h3><p>${safeError}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>`);
    return;
  }
  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    res.status(400).send(`<!DOCTYPE html><html><body><h3>Invalid Authorization Parameters</h3><script>setTimeout(() => window.close(), 3000);</script></body></html>`);
    return;
  }

  const session = InstagramOAuthService.consumeState(state);
  if (!session || !session.userId) {
    res.status(400).send(`<!DOCTYPE html><html><body><h3>Invalid or Expired OAuth State</h3><p>Please restart the Instagram connection flow.</p><script>setTimeout(() => window.close(), 3000);</script></body></html>`);
    return;
  }

  // Re-verify client authorization using the verified identity bound to the OAuth state
  const isAuthorized = await InstagramOAuthService.verifyClientAuthorization(
    session.workspaceId,
    session.clientId,
    session.userId
  );
  if (!isAuthorized) {
    res.status(403).send(`<!DOCTYPE html><html><body><h3>Unauthorized</h3><p>Requester is not permitted to connect this client integration.</p><script>setTimeout(() => window.close(), 3000);</script></body></html>`);
    return;
  }

  const appId = process.env.META_APP_ID || process.env.VITE_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    res.status(503).send(`<!DOCTYPE html><html><body><h3>Server Configuration Error</h3><p>Meta credentials are not configured.</p></body></html>`);
    return;
  }

  const redirectUri =
    process.env.META_OAUTH_REDIRECT_URI ||
    `${req.protocol}://${req.get('host')}/api/auth/instagram/callback`;
  const graphVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || 'v25.0';

  try {
    // 1. Exchange authorization code for user access token using POST to prevent secrets in URL logs
    const tokenUrl = `https://graph.facebook.com/${graphVersion}/oauth/access_token`;
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error?.message || 'Failed to exchange authorization code for access token.');
    }
    let accessToken = tokenData.access_token;
    const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : undefined;
    let tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;

    // 2. Exchange for long-lived user token via POST when supported by Meta
    try {
      const longLivedUrl = `https://graph.facebook.com/${graphVersion}/oauth/access_token`;
      const longLivedParams = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: accessToken
      });

      const longLivedRes = await fetch(longLivedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: longLivedParams.toString()
      });
      if (longLivedRes.ok) {
        const longLivedData = await longLivedRes.json() as any;
        if (longLivedData?.access_token) {
          accessToken = longLivedData.access_token;
          if (typeof longLivedData.expires_in === 'number') {
            tokenExpiresAt = new Date(Date.now() + longLivedData.expires_in * 1000).toISOString();
          }
        }
      }
    } catch {
      // Retain standard token
    }

    // 3. Discover linked Instagram Professional Account via Meta Graph API
    let instagramUserId = '';
    let instagramUsername = '';

    const pagesRes = await fetch(
      `https://graph.facebook.com/${graphVersion}/me/accounts?fields=name,instagram_business_account{id,username}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (pagesRes.ok) {
      const pagesData = await pagesRes.json() as any;
      if (Array.isArray(pagesData?.data)) {
        for (const page of pagesData.data) {
          if (page.instagram_business_account?.id) {
            instagramUserId = page.instagram_business_account.id;
            instagramUsername = page.instagram_business_account.username || page.name || 'business_account';
            break;
          }
        }
      }
    }

    // Fallback: Check user node if granted directly
    if (!instagramUserId) {
      const meRes = await fetch(
        `https://graph.facebook.com/${graphVersion}/me?fields=id,username,name,instagram_business_account{id,username}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (meRes.ok) {
        const meData = await meRes.json() as any;
        if (meData?.instagram_business_account?.id) {
          instagramUserId = meData.instagram_business_account.id;
          instagramUsername = meData.instagram_business_account.username || meData.name || 'business_account';
        }
      }
    }

    if (!instagramUserId) {
      throw new Error(
        'No Instagram Professional (Business or Creator) account could be found linked to your Facebook Page. Please ensure your account is set to Professional and connected to a Facebook Page.'
      );
    }

    await InstagramOAuthService.saveIntegration(
      session.workspaceId,
      session.clientId,
      instagramUserId,
      instagramUsername,
      accessToken,
      tokenExpiresAt
    );

    const safeWsId = JSON.stringify(session.workspaceId);
    const safeClientId = JSON.stringify(session.clientId);

    res.send(`<!DOCTYPE html>
      <html>
        <head><title>Instagram Connected</title></head>
        <body>
          <script>
            (function() {
              if (window.opener) {
                var targetOrigin = window.location.origin;
                window.opener.postMessage({
                  type: 'OAUTH_AUTH_SUCCESS',
                  provider: 'instagram',
                  workspaceId: ${safeWsId},
                  clientId: ${safeClientId}
                }, targetOrigin);
                window.close();
              } else {
                window.location.href = '/';
              }
            })();
          </script>
          <p>Instagram account successfully connected! Closing window...</p>
        </body>
      </html>
    `);
  } catch (err: any) {
    const safeMessage = escapeHtml(err?.message || 'Failed to complete Instagram OAuth.');
    console.error('Instagram OAuth callback error:', safeMessage);
    res.status(500).send(`<!DOCTYPE html><html><body><h3>Authentication Error</h3><p>${safeMessage}</p><script>setTimeout(() => window.close(), 4000);</script></body></html>`);
  }
};

apiRouter.get('/auth/instagram/callback', handleInstagramCallback);
apiRouter.get('/auth/instagram/callback/', handleInstagramCallback);

apiRouter.get('/instagram/status', async (req: Request, res: Response) => {
  const authResult = await verifyServerAuthToken(req);
  if (!authResult.user) {
    res.status(authResult.status || 401).json({ error: authResult.error || 'Authentication required.' });
    return;
  }
  const verifiedUserId = authResult.user.userId;

  const workspaceId = (req.query.workspaceId as string) || 'ws-default-01';
  const clientId = req.query.clientId as string;
  if (!clientId) {
    res.status(400).json({ error: 'clientId is required.' });
    return;
  }

  const isAuthorized = await InstagramOAuthService.verifyClientAuthorization(
    workspaceId,
    clientId.trim(),
    verifiedUserId
  );
  if (!isAuthorized) {
    res.status(403).json({ error: 'Unauthorized: Client does not belong to the workspace or requester is not permitted.' });
    return;
  }

  const integration = await InstagramOAuthService.getIntegration(workspaceId, clientId.trim());
  if (!integration) {
    res.json({ connected: false });
    return;
  }

  res.json({
    connected: true,
    instagramUserId: integration.instagramUserId,
    instagramUsername: integration.instagramUsername,
    connectionStatus: integration.connectionStatus,
    updatedAt: integration.updatedAt
  });
});

apiRouter.delete('/instagram/disconnect', async (req: Request, res: Response) => {
  const authResult = await verifyServerAuthToken(req);
  if (!authResult.user) {
    res.status(authResult.status || 401).json({ error: authResult.error || 'Authentication required.' });
    return;
  }
  const verifiedUserId = authResult.user.userId;

  const workspaceId = (req.query.workspaceId as string) || (req.body?.workspaceId as string) || 'ws-default-01';
  const clientId = (req.query.clientId as string) || (req.body?.clientId as string);

  if (!clientId) {
    res.status(400).json({ error: 'clientId is required.' });
    return;
  }

  const isAuthorized = await InstagramOAuthService.verifyClientAuthorization(
    workspaceId,
    clientId.trim(),
    verifiedUserId
  );
  if (!isAuthorized) {
    res.status(403).json({ error: 'Unauthorized: Client does not belong to the workspace or requester is not permitted.' });
    return;
  }

  // Attempt Meta permission revocation if active decrypted token exists
  try {
    const creds = await InstagramOAuthService.getDecryptedToken(workspaceId, clientId.trim(), verifiedUserId);
    if (creds?.accessToken) {
      const graphVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || 'v25.0';
      await fetch(`https://graph.facebook.com/${graphVersion}/me/permissions`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${creds.accessToken}` }
      });
    }
  } catch {
    // Revocation failure does not block database deletion
  }

  const success = await InstagramOAuthService.deleteIntegration(workspaceId, clientId.trim(), verifiedUserId);
  res.json({ success });
});


apiRouter.get('/instagram/status', async (req: Request, res: Response) => {
  const authResult = await verifyServerAuthToken(req);
  if (!authResult.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const workspaceId = req.query.workspaceId as string;
  const clientId = req.query.clientId as string;

  if (!workspaceId || !clientId) {
    res.status(400).json({ error: 'workspaceId and clientId are required.' });
    return;
  }

  const isAuth = await InstagramOAuthService.verifyClientAuthorization(
    workspaceId,
    clientId.trim(),
    authResult.user.userId
  );

  if (!isAuth) {
    res.status(403).json({ error: 'Unauthorized.' });
    return;
  }

  try {
    const integration = await InstagramOAuthService.getIntegration(workspaceId, clientId.trim());
    
    if (!integration) {
      res.json({
        status: 'Not Configured',
        message: 'Instagram Business Discovery is not connected for this client.'
      });
      return;
    }

    if (integration.connectionStatus === 'Expired' || integration.connectionStatus === 'Revoked') {
      res.json({
        status: 'Error',
        message: `Instagram connection for this client is ${integration.connectionStatus.toLowerCase()}. Please reconnect.`
      });
      return;
    }

    res.json({
      status: 'Connected',
      message: 'Instagram Business Discovery is connected.',
      providerName: 'Instagram Graph API Business Discovery'
    });
  } catch (error) {
    console.error('API /instagram/status error:', error);
    res.status(500).json({ error: 'Failed to fetch Instagram status.' });
  }
});
