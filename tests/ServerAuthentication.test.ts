import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { apiRouter } from '../src/server/apiHandler';
import {
  InstagramOAuthService,
  registerLocalClient,
  clearLocalRegisteredClients
} from '../src/server/instagramOAuthService';
import { createSignedTestToken, verifyServerAuthToken } from '../src/server/serverAuthService';

const TEST_SECRET = 'audit-security-key-32-bytes-long!!';
let server: Server;
let baseUrl = '';

test.before(async () => {
  process.env.AUTH_JWT_SECRET = TEST_SECRET;
  process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = TEST_SECRET;
  process.env.META_APP_ID = 'meta-test-app-id-123';
  process.env.META_APP_SECRET = 'meta-test-app-secret-456';
  process.env.META_OAUTH_REDIRECT_URI = 'http://localhost/api/auth/instagram/callback';

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
});

test.beforeEach(() => {
  clearLocalRegisteredClients();
});

test.afterEach(() => {
  clearLocalRegisteredClients();
});

test('Auth 1: Missing authentication is rejected across all Instagram endpoints', async () => {
  const ws = 'ws-test';
  const client = 'client-1';

  // 1. GET /api/auth/instagram/start without Authorization header
  const startRes = await fetch(`${baseUrl}/api/auth/instagram/start?workspaceId=${ws}&clientId=${client}`);
  assert.equal(startRes.status, 401, 'Missing token on start must return 401');
  const startBody = await startRes.json();
  assert.ok(startBody.error.includes('Authentication required'));

  // 2. GET /api/instagram/status without Authorization header
  const statusRes = await fetch(`${baseUrl}/api/instagram/status?workspaceId=${ws}&clientId=${client}`);
  assert.equal(statusRes.status, 401, 'Missing token on status must return 401');
  const statusBody = await statusRes.json();
  assert.ok(statusBody.error.includes('Authentication required'));

  // 3. DELETE /api/instagram/disconnect without Authorization header
  const disconnectRes = await fetch(`${baseUrl}/api/instagram/disconnect?workspaceId=${ws}&clientId=${client}`, {
    method: 'DELETE'
  });
  assert.equal(disconnectRes.status, 401, 'Missing token on disconnect must return 401');
  const disconnectBody = await disconnectRes.json();
  assert.ok(disconnectBody.error.includes('Authentication required'));
});

test('Auth 2: Invalid and expired tokens are rejected with HTTP 401', async () => {
  const ws = 'ws-test';
  const client = 'client-1';

  // 1. Malformed token (not a JWT)
  const malformedRes = await fetch(`${baseUrl}/api/auth/instagram/start?workspaceId=${ws}&clientId=${client}`, {
    headers: { Authorization: 'Bearer this-is-not-a-jwt' }
  });
  assert.equal(malformedRes.status, 401);
  const malformedBody = await malformedRes.json();
  assert.ok(malformedBody.error.includes('Malformed') || malformedBody.error.includes('three dot-separated'));

  // 2. Expired token (exp in past)
  const pastExp = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago
  const expiredToken = createSignedTestToken({ userId: 'user-expired', exp: pastExp }, TEST_SECRET);
  const expiredRes = await fetch(`${baseUrl}/api/auth/instagram/start?workspaceId=${ws}&clientId=${client}`, {
    headers: { Authorization: `Bearer ${expiredToken}` }
  });
  assert.equal(expiredRes.status, 401);
  const expiredBody = await expiredRes.json();
  assert.ok(expiredBody.error.includes('expired'));

  // 3. Tampered signature
  const validToken = createSignedTestToken({ userId: 'user-legit' }, TEST_SECRET);
  const parts = validToken.split('.');
  const tamperedSig = parts[2].slice(0, -4) + 'zzzz';
  const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;

  const tamperedRes = await fetch(`${baseUrl}/api/auth/instagram/start?workspaceId=${ws}&clientId=${client}`, {
    headers: { Authorization: `Bearer ${tamperedToken}` }
  });
  assert.equal(tamperedRes.status, 401);
  const tamperedBody = await tamperedRes.json();
  assert.ok(tamperedBody.error.includes('Invalid') && tamperedBody.error.includes('signature'));
});

test('Auth 3: A forged userId query parameter cannot impersonate another user', async () => {
  const ws = 'ws-corp';
  const client = 'client-vip';
  const ownerUser = 'user-owner-alice';
  const attackerUser = 'user-attacker-bob';

  // Register client strictly owned by Alice
  registerLocalClient(ws, client, ownerUser);

  // Bob generates a valid token for Bob
  const bobToken = createSignedTestToken({ userId: attackerUser }, TEST_SECRET);

  // Bob attempts to start Instagram OAuth claiming Alice's userId in query parameter
  const res = await fetch(
    `${baseUrl}/api/auth/instagram/start?workspaceId=${ws}&clientId=${client}&userId=${ownerUser}`,
    {
      headers: { Authorization: `Bearer ${bobToken}` }
    }
  );

  // Server must derive identity from bobToken, ignore forged ?userId=user-owner-alice, and return 403 Forbidden
  assert.equal(res.status, 403, 'Forged query parameter must NOT bypass authorization');
  const body = await res.json();
  assert.ok(body.error.includes('Unauthorized') || body.error.includes('not permitted'));
});

test('Auth 4: An arbitrary x-user-id header cannot impersonate another user', async () => {
  const ws = 'ws-corp';
  const client = 'client-vip';
  const ownerUser = 'user-owner-alice';
  const attackerUser = 'user-attacker-bob';

  registerLocalClient(ws, client, ownerUser);

  const bobToken = createSignedTestToken({ userId: attackerUser }, TEST_SECRET);

  // Bob sends x-user-id: user-owner-alice header to impersonate Alice
  const res = await fetch(`${baseUrl}/api/instagram/status?workspaceId=${ws}&clientId=${client}`, {
    headers: {
      Authorization: `Bearer ${bobToken}`,
      'x-user-id': ownerUser
    }
  });

  assert.equal(res.status, 403, 'Arbitrary x-user-id header must be ignored; attacker must be rejected');
});

test('Auth 5: A user cannot connect or disconnect another client integration', async () => {
  const ws = 'ws-agency';
  const clientA = 'client-a';
  const clientB = 'client-b';
  const userA = 'user-a';
  const userB = 'user-b';

  // Register clientA to userA, clientB to userB
  registerLocalClient(ws, clientA, userA);
  registerLocalClient(ws, clientB, userB);

  const tokenUserB = createSignedTestToken({ userId: userB }, TEST_SECRET);

  // User B attempts to connect clientA (owned by userA)
  const connectRes = await fetch(`${baseUrl}/api/auth/instagram/start?workspaceId=${ws}&clientId=${clientA}`, {
    headers: { Authorization: `Bearer ${tokenUserB}` }
  });
  assert.equal(connectRes.status, 403, 'User B must not connect User A client');

  // User B attempts to disconnect clientA (owned by userA)
  const disconnectRes = await fetch(`${baseUrl}/api/instagram/disconnect?workspaceId=${ws}&clientId=${clientA}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenUserB}` }
  });
  assert.equal(disconnectRes.status, 403, 'User B must not disconnect User A client');

  // User A with User A token successfully initiates start for clientA
  const tokenUserA = createSignedTestToken({ userId: userA }, TEST_SECRET);
  const connectUserARes = await fetch(`${baseUrl}/api/auth/instagram/start?workspaceId=${ws}&clientId=${clientA}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` }
  });
  assert.equal(connectUserARes.status, 200, 'User A must successfully start OAuth for own client');
  const connectBody = await connectUserARes.json();
  assert.ok(connectBody.url.includes('facebook.com'));
});

test('Auth 6: Omitting userId cannot skip authorization', async () => {
  const ws = 'ws-agency';
  const client = 'client-xyz';

  registerLocalClient(ws, client, 'user-admin');

  // Direct service call omitting userId
  const omittedAuth = await InstagramOAuthService.verifyClientAuthorization(ws, client, undefined);
  assert.equal(omittedAuth, false, 'Omitting userId must return false');

  const emptyAuth = await InstagramOAuthService.verifyClientAuthorization(ws, client, '');
  assert.equal(emptyAuth, false, 'Empty userId must return false');

  const whitespaceAuth = await InstagramOAuthService.verifyClientAuthorization(ws, client, '   ');
  assert.equal(whitespaceAuth, false, 'Whitespace userId must return false');
});

test('Auth 7: OAuth state is bound exclusively to verified identity and enforces single-use', async () => {
  const ws = 'ws-state-check';
  const client = 'client-state-check';
  const user = 'user-state-verified';

  registerLocalClient(ws, client, user);

  const token = createSignedTestToken({ userId: user }, TEST_SECRET);
  const startRes = await fetch(`${baseUrl}/api/auth/instagram/start?workspaceId=${ws}&clientId=${client}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(startRes.status, 200);
  const startData = await startRes.json();
  const urlObj = new URL(startData.url);
  const state = urlObj.searchParams.get('state');
  assert.ok(state);

  // Consume state: verify it is bound to the verified user
  const session = InstagramOAuthService.consumeState(state);
  assert.ok(session);
  assert.equal(session.workspaceId, ws);
  assert.equal(session.clientId, client);
  assert.equal(session.userId, user);

  // Replay attempt must fail (single-use guarantee)
  const replay = InstagramOAuthService.consumeState(state);
  assert.equal(replay, null, 'Replaying consumed state must fail');
});
