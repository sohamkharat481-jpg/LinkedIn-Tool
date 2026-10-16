import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { apiRouter } from '../src/server/apiHandler';
import { ServerLeadProviderService } from '../src/server/leadProviderService';
import { OverpassApiError } from '../src/services/leadProviders/OverpassLeadProvider';

test('returns a structured Overpass timeout before the hosting execution limit', async () => {
  const originalFetchCandidateLeads = ServerLeadProviderService.fetchCandidateLeads;
  const originalConsoleError = console.error;
  ServerLeadProviderService.fetchCandidateLeads = async () => {
    throw new OverpassApiError('Total request budget exceeded (6000ms).', undefined, {
      timeoutFired: true,
      failureOrigin: 'application_deadline',
      failurePhase: 'request'
    });
  };
  console.error = () => {};

  const app = express();
  app.use(apiRouter);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const startedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:${address.port}/search-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerType: 'overpass',
        filters: {
          jobTitles: [],
          industry: [],
          country: 'United Kingdom',
          city: 'London',
          seniority: [],
          companySize: [],
          maxLeads: 1
        }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 504);
    assert.equal(body.code, 'OVERPASS_API_ERROR');
    assert.match(body.error, /Total request budget exceeded/);
    assert.ok(Date.now() - startedAt < 7500);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
    ServerLeadProviderService.fetchCandidateLeads = originalFetchCandidateLeads;
    console.error = originalConsoleError;
  }
});
