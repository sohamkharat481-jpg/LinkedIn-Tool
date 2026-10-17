import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InstagramOAuthService,
  registerLocalClient,
  clearLocalRegisteredClients
} from '../src/server/instagramOAuthService';
import { encryptAccessToken, decryptAccessToken } from '../src/server/cryptoService';
import { ServerLeadProviderService } from '../src/server/leadProviderService';
import { testSupabaseHealth, isPlaceholderUrl, isPlaceholderKey } from '../src/services/supabase';

const originalEncryptionKey = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
const originalToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const originalUserId = process.env.INSTAGRAM_USER_ID;

test.beforeEach(() => {
  process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = 'audit-security-key-32-bytes-long!!';
  clearLocalRegisteredClients();
});

test.afterEach(() => {
  if (originalEncryptionKey === undefined) {
    delete process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
  }
  if (originalToken === undefined) {
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
  } else {
    process.env.INSTAGRAM_ACCESS_TOKEN = originalToken;
  }
  if (originalUserId === undefined) {
    delete process.env.INSTAGRAM_USER_ID;
  } else {
    process.env.INSTAGRAM_USER_ID = originalUserId;
  }
  clearLocalRegisteredClients();
});

test('Audit 1: OAuth state is bound to user, workspace, and client, and is single-use', () => {
  const ws = 'ws-sec-01';
  const client = 'client-sec-01';
  const user = 'user-sec-99';

  const state = InstagramOAuthService.createState(ws, client, user);
  assert.equal(typeof state, 'string');
  assert.equal(state.length, 64); // 32 random bytes as hex

  const consumed = InstagramOAuthService.consumeState(state);
  assert.ok(consumed);
  assert.equal(consumed.workspaceId, ws);
  assert.equal(consumed.clientId, client);
  assert.equal(consumed.userId, user);

  // Single-use guarantee: Replay must immediately return null
  const replayed = InstagramOAuthService.consumeState(state);
  assert.equal(replayed, null);
});

test('Audit 2: Client authorization rejects cross-tenant client tampering', async () => {
  const wsAlpha = 'ws-alpha';
  const wsBeta = 'ws-beta';
  const clientAlpha = 'client-alpha-001';

  // Register client strictly to wsAlpha
  registerLocalClient(wsAlpha, clientAlpha, 'user-owner-1');

  // Attempt to authorize clientAlpha under wsBeta (cross-tenant tampering)
  const isAuthorizedUnderBeta = await InstagramOAuthService.verifyClientAuthorization(
    wsBeta,
    clientAlpha
  );
  assert.equal(
    isAuthorizedUnderBeta,
    false,
    'Client ID from Alpha must be rejected when claimed under Beta workspace'
  );

  // Valid authorization under wsAlpha
  const isAuthorizedUnderAlpha = await InstagramOAuthService.verifyClientAuthorization(
    wsAlpha,
    clientAlpha,
    'user-owner-1'
  );
  assert.equal(isAuthorizedUnderAlpha, true);

  // Unauthorized user under wsAlpha
  const isUnauthorizedUser = await InstagramOAuthService.verifyClientAuthorization(
    wsAlpha,
    clientAlpha,
    'different-user-2'
  );
  assert.equal(
    isUnauthorizedUser,
    false,
    'Different user must be rejected if client has specific owner'
  );
});

test('Audit 3: AES-256-GCM crypto enforces IV uniqueness and strict parameter lengths', () => {
  const token = 'EAAK...very_secret_token_value_abc123';

  // IV Uniqueness: two encryptions of the same plaintext must produce distinct ciphertexts and IVs
  const enc1 = encryptAccessToken(token);
  const enc2 = encryptAccessToken(token);
  assert.notEqual(enc1, enc2);

  const [iv1, tag1] = enc1.split(':');
  const [iv2] = enc2.split(':');
  assert.notEqual(iv1, iv2);
  assert.equal(iv1.length, 24); // 12-byte hex
  assert.equal(tag1.length, 32); // 16-byte hex

  // Malformed IV rejection
  assert.throws(() => {
    decryptAccessToken('shortiv:0123456789abcdef0123456789abcdef:deadbeef');
  }, /Invalid IV format/);

  // Malformed Auth Tag rejection
  assert.throws(() => {
    decryptAccessToken('0123456789abcdef01234567:shorttag:deadbeef');
  }, /Invalid authentication tag format/);

  // Tampered ciphertext authentication tag failure
  assert.throws(() => {
    const parts = enc1.split(':');
    const tamperedCipher = parts[2].slice(0, -2) + (parts[2].slice(-2) === 'aa' ? 'bb' : 'aa');
    decryptAccessToken(`${parts[0]}:${parts[1]}:${tamperedCipher}`);
  });
});

test('Audit 4: Plaintext token is never leaked in getIntegration metadata', async () => {
  const ws = 'ws-privacy';
  const client = 'client-privacy';
  const plainSecret = 'super-secret-user-access-token';

  await InstagramOAuthService.saveIntegration(
    ws,
    client,
    'ig-user-12345',
    'ig_handle_test',
    plainSecret
  );

  const meta = await InstagramOAuthService.getIntegration(ws, client);
  assert.ok(meta);
  assert.equal((meta as any).plainAccessToken, undefined);
  assert.equal((meta as any).accessToken, undefined);

  // Decrypted token is only available through explicit server-side getDecryptedToken
  const decrypted = await InstagramOAuthService.getDecryptedToken(ws, client);
  assert.ok(decrypted);
  assert.equal(decrypted.accessToken, plainSecret);

  await InstagramOAuthService.deleteIntegration(ws, client);
});

test('Audit 5: Expired integration is explicitly rejected without silent fallback to global credentials', async () => {
  process.env.INSTAGRAM_ACCESS_TOKEN = 'global-agency-access-token';
  process.env.INSTAGRAM_USER_ID = 'global-agency-user-id';

  const ws = 'ws-expiry-audit';
  const client = 'client-expiry-audit';

  // Save integration with past expiration date
  const pastDate = new Date(Date.now() - 60000).toISOString();
  await InstagramOAuthService.saveIntegration(
    ws,
    client,
    'client-ig-id',
    'client_ig_user',
    'client-expired-token',
    pastDate
  );

  // Connection test for this client must report Expired Token error rather than silently succeeding with global key
  const testRes = await ServerLeadProviderService.testConnection(
    undefined,
    'instagram_business',
    ws,
    client
  );
  assert.equal(testRes.success, false);
  assert.equal(testRes.authStatus, 'Expired Token');
  assert.ok(testRes.message.includes('expired'));

  // Lead search for this client must throw expired error
  await assert.rejects(
    async () => {
      await ServerLeadProviderService.fetchCandidateLeads(
        {
          jobTitles: ['Founder'],
          industry: ['Tech'],
          country: 'US',
          seniority: ['Director'],
          companySize: ['11-50'],
          maxLeads: 10,
          instagramUsernames: ['testbrand']
        },
        undefined,
        'instagram_business',
        ws,
        client
      );
    },
    /expired/i
  );

  await InstagramOAuthService.deleteIntegration(ws, client);
});

test('Audit 6: Disconnect removes integration and denies subsequent credential access', async () => {
  const ws = 'ws-disconnect-audit';
  const client = 'client-disconnect-audit';

  await InstagramOAuthService.saveIntegration(
    ws,
    client,
    'client-ig-id',
    'client_ig_user',
    'token-to-delete'
  );

  const before = await InstagramOAuthService.getDecryptedToken(ws, client);
  assert.ok(before);

  await InstagramOAuthService.deleteIntegration(ws, client);

  const afterMeta = await InstagramOAuthService.getIntegration(ws, client);
  assert.equal(afterMeta, null);

  const afterCreds = await InstagramOAuthService.getDecryptedToken(ws, client);
  assert.equal(afterCreds, null);
});

test('Audit 7: Placeholder detection identifies default URLs and dummy keys without network calls', () => {
  assert.equal(isPlaceholderUrl('https://your-project.supabase.co'), true);
  assert.equal(isPlaceholderUrl('https://example.com'), true);
  assert.equal(isPlaceholderUrl('https://myrealproject.supabase.co'), false);

  assert.equal(isPlaceholderKey('your-supabase-anon-key'), true);
  assert.equal(isPlaceholderKey('placeholder_key'), true);
  assert.equal(isPlaceholderKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5eiIsInJvbGUiOiJhbm9uIn0.abcdefghijklmnopqrstuvwxyz1234567890'), false);
});

test('Audit 8: Diagnostic health check accurately reports placeholder configuration without exposing credentials', async () => {
  const result = await testSupabaseHealth();
  assert.ok(result);
  assert.equal(result.failureCategory, 'PLACEHOLDER_CONFIGURATION');
  assert.equal(result.DATABASE_QUERY, 'SKIPPED');
  // Confirm credentials are never exposed in result
  assert.equal((result as any).url, undefined);
  assert.equal((result as any).key, undefined);
  assert.equal((result as any).token, undefined);
});
