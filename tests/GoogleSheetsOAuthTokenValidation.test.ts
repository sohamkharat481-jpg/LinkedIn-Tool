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

test('Google Sheets export returns success immediately when no leads are provided', async () => {
  const result = await exportLeadsToGoogleSheet('dummy-token-1234567890', 'Test Client', []);
  assert.equal(result.success, true);
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
