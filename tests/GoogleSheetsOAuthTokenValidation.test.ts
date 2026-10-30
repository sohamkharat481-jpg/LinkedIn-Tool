import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyGoogleAccountConnection, getCachedAccessToken, setCachedAccessToken } from '../src/services/auth';
import { exportLeadsToGoogleSheet } from '../src/services/sheetsExport';

test('Google OAuth token validation rejects empty or missing tokens', async () => {
  await assert.rejects(
    async () => {
      await verifyGoogleAccountConnection('');
    },
    {
      name: 'Error',
      message: 'Invalid or missing OAuth token.'
    }
  );

  await assert.rejects(
    async () => {
      await verifyGoogleAccountConnection('short');
    },
    {
      name: 'Error',
      message: 'Invalid or missing OAuth token.'
    }
  );
});

test('Google Sheets export requires a valid access token', async () => {
  await assert.rejects(
    async () => {
      await exportLeadsToGoogleSheet('', 'Test Client', [
        {
          id: 'lead-1',
          workspaceId: 'ws-1',
          clientId: 'client-1',
          fullName: 'Jane Doe',
          headline: 'VP Sales',
          currentJobTitle: 'VP Sales',
          companyName: 'Acme',
          location: 'San Francisco, CA',
          profileUrl: 'https://www.linkedin.com/in/janedoe',
          connectionsOrFollowers: '500+',
          lastActivityDate: '2026-10-01',
          dateAdded: '2026-10-23',
          status: 'Not Contacted',
          notes: '',
          source: 'Wikidata'
        }
      ]);
    },
    {
      name: 'Error',
      message: 'Google OAuth Access Token is missing. Please sign in with Google first.'
    }
  );
});

test('Google Sheets export reports failure when zero leads are provided', async () => {
  const result = await exportLeadsToGoogleSheet('dummy-token-1234567890', 'Test Client', []);
  assert.equal(result.success, false);
  assert.equal(result.addedCount, 0);
  assert.equal(result.skippedDuplicatesCount, 0);
});

test('Cached access token management functions predictably in memory', () => {
  setCachedAccessToken(null);
  assert.equal(getCachedAccessToken(), null);

  setCachedAccessToken('ya29.sample_oauth_access_token');
  assert.equal(getCachedAccessToken(), 'ya29.sample_oauth_access_token');

  setCachedAccessToken(null);
  assert.equal(getCachedAccessToken(), null);
});

test('Google Sheets export verifies actual inserted row count from API response', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('drive/v3/files')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('v4/spreadsheets') && !urlStr.includes('append')) {
        return new Response(JSON.stringify({ spreadsheetId: 'sheet-mock-999' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('append')) {
        return new Response(
          JSON.stringify({
            spreadsheetId: 'sheet-mock-999',
            tableRange: 'Leads!A1:R1',
            updates: {
              spreadsheetId: 'sheet-mock-999',
              updatedRange: 'Leads!A2:R3',
              updatedRows: 2,
              updatedColumns: 18,
              updatedCells: 36
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(url, init);
    };

    const dummyLeads: any[] = [
      {
        id: 'lead-1',
        workspaceId: 'ws-1',
        clientId: 'client-1',
        fullName: 'Jane Doe',
        headline: 'VP Sales',
        currentJobTitle: 'VP Sales',
        companyName: 'Acme',
        location: 'San Francisco, CA',
        profileUrl: 'https://www.linkedin.com/in/janedoe',
        connectionsOrFollowers: '500+',
        lastActivityDate: '2026-10-01',
        dateAdded: '2026-10-23',
        status: 'Not Contacted',
        notes: '',
        source: 'Wikidata'
      },
      {
        id: 'lead-2',
        workspaceId: 'ws-1',
        clientId: 'client-1',
        fullName: 'John Smith',
        headline: 'CTO',
        currentJobTitle: 'CTO',
        companyName: 'Tech Corp',
        location: 'New York, NY',
        profileUrl: 'https://www.linkedin.com/in/johnsmith',
        connectionsOrFollowers: '1000+',
        lastActivityDate: '2026-10-02',
        dateAdded: '2026-10-23',
        status: 'Not Contacted',
        notes: '',
        source: 'Wikidata'
      }
    ];

    const res = await exportLeadsToGoogleSheet('valid-test-token-12345', 'Dental Clinic', dummyLeads);
    assert.equal(res.success, true);
    assert.equal(res.spreadsheetId, 'sheet-mock-999');
    assert.equal(res.addedCount, 2);
    assert.equal(res.updatedRows, 2);
    assert.match(res.spreadsheetUrl, /docs\.google\.com\/spreadsheets\/d\/sheet-mock-999/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
