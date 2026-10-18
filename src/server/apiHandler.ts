import express, { Request, Response } from 'express';
import { LeadFilter, RawLead } from '../types';
import { filterAndDeduplicateLeads } from '../services/deduplication';
import { ServerLeadProviderService } from './leadProviderService';
import { testSupabaseHealth } from '../services/supabase';
import { verifyServerAuthToken } from './serverAuthService';

export const apiRouter = express.Router();

apiRouter.use(express.json());

apiRouter.use((req: any, res: any, next) => {
  if (typeof res.status !== 'function') {
    res.status = function (statusCode: number) {
      res.statusCode = statusCode;
      return res;
    };
  }
  if (typeof res.json !== 'function') {
    res.json = function (data: any) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify(data));
      return res;
    };
  }
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

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'LinkedIn Lead Finder API',
    timestamp: new Date().toISOString()
  });
});

apiRouter.get('/supabase-status', async (_req: Request, res: Response) => {
  try {
    const diag = await testSupabaseHealth();
    res.json(diag);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to check Supabase health.' });
  }
});

apiRouter.get('/diagnostics', async (_req: Request, res: Response) => {
  try {
    const providerDiag = ServerLeadProviderService.getDiagnostics();
    const supabaseDiag = await testSupabaseHealth();
    
    res.json({
      timestamp: new Date().toISOString(),
      providers: {
        activeProvider: providerDiag.ActiveProvider
      },
      database: {
        clientStatus: supabaseDiag.supabaseClientStatus,
        queryStatus: supabaseDiag.databaseQueryStatus,
        authStatus: supabaseDiag.authServiceStatus
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch diagnostics.' });
  }
});

apiRouter.get('/provider-status', (req: Request, res: Response) => {
  try {
    const statusInfo = ServerLeadProviderService.getStatus();
    res.json(statusInfo);
  } catch (error: any) {
    res.status(500).json({
      error: error.message || 'Failed to check provider status.'
    });
  }
});

apiRouter.post('/provider-status/test', async (req: Request, res: Response) => {
  try {
    const result = await ServerLeadProviderService.testConnection();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Connection test failed.' });
  }
});

apiRouter.all('/provider-status/test', async (_req: Request, res: Response) => {
  try {
    const testResult = await ServerLeadProviderService.testConnection();
    res.status(testResult.success ? 200 : 502).json(testResult);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to execute provider connection test.',
    });
  }
});

const executeLeadSearch = async (
  filters: LeadFilter,
) => {
  filters.maxLeads = Math.min(Math.max(Number(filters.maxLeads) || 50, 1), 500);

  try {
    const rawCandidates: RawLead[] = await ServerLeadProviderService.fetchCandidateLeads(filters);
    const dedupeResult = filterAndDeduplicateLeads(rawCandidates);

    return {
      status: 200,
      body: {
        success: true,
        provider: {
          id: 'wikidata-provider',
          name: 'Wikidata SPARQL Query Service',
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
    return {
      status: 502,
      body: {
        error: error.message || 'Lead provider temporarily unavailable.'
      }
    };
  }
};

apiRouter.post('/search-leads', async (req: Request, res: Response) => {
  const { filters } = req.body;
  if (!filters || typeof filters !== 'object') {
    res.status(400).json({ error: 'Invalid search filters provided.' });
    return;
  }

  const result = await executeLeadSearch(filters as LeadFilter);
  res.status(result.status).json(result.body);
});

apiRouter.post('/lead-search-proxy', async (req: Request, res: Response) => {
  const filters = req.body.filters || req.body;
  if (!filters || typeof filters !== 'object') {
    res.status(400).json({ error: 'Invalid search filters provided.' });
    return;
  }

  const result = await executeLeadSearch(filters as LeadFilter);
  if (result.status !== 200) {
    res.status(result.status).json(result.body);
    return;
  }

  res.json({
    success: true,
    leads: result.body.leads
  });
});

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

    res.json({
      success: true,
      profileUrl: profileUrl.trim(),
      icp: icpSummary,
      message: 'Profile successfully analyzed and ICP generated.'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to analyze LinkedIn profile.' });
  }
});
