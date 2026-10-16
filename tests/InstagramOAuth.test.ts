import assert from 'node:assert/strict';
import test from 'node:test';
import { InstagramOAuthService } from '../src/server/instagramOAuthService';
import { encryptAccessToken, decryptAccessToken } from '../src/server/cryptoService';

const originalEncryptionKey = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
const originalToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const originalUserId = process.env.INSTAGRAM_USER_ID;

test.beforeEach(() => {
  process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = 'test-oauth-encryption-key-32-bytes!!';
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
});

test('InstagramOAuthService generates and consumes single-use states correctly', () => {
  const workspaceId = 'ws-test-01';
  const clientId = 'client-test-01';

  const state = InstagramOAuthService.createState(workspaceId, clientId);
  assert.equal(typeof state, 'string');
  assert.ok(state.length >= 32);

  const consumed = InstagramOAuthService.consumeState(state);
  assert.deepEqual(consumed, { workspaceId, clientId });

  // Second consumption attempt must fail (single-use)
  const reconsumed = InstagramOAuthService.consumeState(state);
  assert.equal(reconsumed, null);
});

test('InstagramOAuthService rejects invalid or expired states', () => {
  const invalid = InstagramOAuthService.consumeState('nonexistent-state-token');
  assert.equal(invalid, null);
});

test('Token encryption and decryption preserves confidentiality and integrity', () => {
  const secretToken = 'EAAG...test_instagram_long_lived_token';

  const encrypted = encryptAccessToken(secretToken);
  assert.notEqual(encrypted, secretToken);

  const decrypted = decryptAccessToken(encrypted);
  assert.equal(decrypted, secretToken);
});

test('Integration persistence preserves workspace and client isolation boundaries', async () => {
  const ws1 = 'ws-tenant-alpha';
  const ws2 = 'ws-tenant-beta';
  const client1 = 'client-alpha-01';
  const client2 = 'client-beta-01';

  await InstagramOAuthService.saveIntegration(
    ws1,
    client1,
    'user-id-alpha',
    'instagram_alpha',
    'alpha-secret-token'
  );

  // Client 1 in Workspace 1 should have integration
  const int1 = await InstagramOAuthService.getIntegration(ws1, client1);
  assert.ok(int1);
  assert.equal(int1.instagramUsername, 'instagram_alpha');
  assert.equal(int1.connectionStatus, 'Connected');
  // Plaintext token must NEVER be returned in integration metadata
  assert.equal((int1 as any).plainAccessToken, undefined);
  assert.notEqual(int1.encryptedAccessToken, 'alpha-secret-token');

  // Client 2 in Workspace 1 should NOT have integration
  const intOtherClient = await InstagramOAuthService.getIntegration(ws1, client2);
  assert.equal(intOtherClient, null);

  // Client 1 in Workspace 2 should NOT have integration (workspace isolation)
  const intOtherWs = await InstagramOAuthService.getIntegration(ws2, client1);
  assert.equal(intOtherWs, null);

  // Decrypted token lookup enforces tenant boundaries
  const creds1 = await InstagramOAuthService.getDecryptedToken(ws1, client1);
  assert.ok(creds1);
  assert.equal(creds1.accessToken, 'alpha-secret-token');
  assert.equal(creds1.instagramUserId, 'user-id-alpha');

  const credsOtherWs = await InstagramOAuthService.getDecryptedToken(ws2, client1);
  assert.equal(credsOtherWs, null);

  // Disconnect purges credentials
  await InstagramOAuthService.deleteIntegration(ws1, client1);
  const afterDelete = await InstagramOAuthService.getIntegration(ws1, client1);
  assert.equal(afterDelete, null);
  const afterDeleteCreds = await InstagramOAuthService.getDecryptedToken(ws1, client1);
  assert.equal(afterDeleteCreds, null);
});

test('Expired token is flagged and prevented from returning active credentials', async () => {
  const ws = 'ws-expired-test';
  const client = 'client-expired-test';

  // Save integration with past expiry date
  const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
  await InstagramOAuthService.saveIntegration(
    ws,
    client,
    'user-id-expired',
    'instagram_expired',
    'expired-token',
    pastDate
  );

  const integration = await InstagramOAuthService.getIntegration(ws, client);
  assert.ok(integration);
  assert.equal(integration.connectionStatus, 'Expired');

  // Decrypted credentials must NOT be returned for expired integration (requires reconnect)
  const creds = await InstagramOAuthService.getDecryptedToken(ws, client);
  assert.equal(creds, null);

  await InstagramOAuthService.deleteIntegration(ws, client);
});

test('ServerLeadProviderService selects client-specific token over global fallback', async () => {
  process.env.INSTAGRAM_ACCESS_TOKEN = 'global-env-fallback-token';
  process.env.INSTAGRAM_USER_ID = 'global-env-user-id';

  const ws = 'ws-client-override';
  const client = 'client-override-01';

  // Save client-specific integration
  await InstagramOAuthService.saveIntegration(
    ws,
    client,
    'client-specific-user-id',
    'client_ig_account',
    'client-specific-access-token'
  );

  // When client context is provided, decrypted client token is selected
  const resolved = await InstagramOAuthService.getDecryptedToken(ws, client);
  assert.ok(resolved);
  assert.equal(resolved.accessToken, 'client-specific-access-token');
  assert.equal(resolved.instagramUserId, 'client-specific-user-id');

  // For another client without integration, fallback to global is available
  const otherResolved = await InstagramOAuthService.getDecryptedToken(ws, 'client-without-integration');
  assert.equal(otherResolved, null);

  await InstagramOAuthService.deleteIntegration(ws, client);
});
