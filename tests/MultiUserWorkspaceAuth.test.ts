import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSignedTestToken,
  verifyServerAuthToken,
  isEmailAuthorized,
  registerWorkspaceAuthorization,
  isUserAuthorizedForWorkspace,
  verifyWorkspaceAccess,
  clearWorkspaceAuthorizations
} from '../src/server/serverAuthService';
import { apiRouter } from '../src/server/apiHandler';
import http from 'node:http';

// Helper to simulate API requests through express apiRouter
function makeSimulatedRequest(
  method: string,
  urlPath: string,
  headers: Record<string, string>,
  body?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      apiRouter(req as any, res as any, (err?: any) => {
        if (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message || 'Internal Router Error' }));
        } else if (!res.writableEnded) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Route not found' }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      const reqOpts = {
        host: '127.0.0.1',
        port: address.port,
        path: urlPath,
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(reqOpts, (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          server.close();
          try {
            const parsed = rawData ? JSON.parse(rawData) : {};
            resolve({ status: res.statusCode || 500, body: parsed });
          } catch {
            resolve({ status: res.statusCode || 500, body: { text: rawData } });
          }
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

test('TEST A: A previously unseen authenticated user can create/initialize their own workspace', async () => {
  clearWorkspaceAuthorizations();
  const token = createSignedTestToken({
    userId: 'user-first-time-999',
    email: 'newunseenuser@example.com'
  });

  const res = await makeSimulatedRequest('GET', '/workspaces', {
    authorization: `Bearer ${token}`
  });

  assert.equal(res.status, 200, 'GET /workspaces should return HTTP 200 for newly seen authenticated user');
  assert.ok(Array.isArray(res.body.workspaces), 'Response should contain workspaces array');
  assert.equal(res.body.workspaces.length, 1, 'Newly seen user should have exactly 1 workspace initialized');
  assert.ok(res.body.workspaces[0].id, 'Workspace must have a valid ID');
  assert.match(res.body.workspaces[0].name, /Newunseenuser/i, 'Workspace title should derive from user email');
});

test('TEST B: A second authenticated user with a different email and UID can create their own independent workspace', async () => {
  const tokenUser2 = createSignedTestToken({
    userId: 'user-second-888',
    email: 'seconduser.independent@domain.com'
  });

  const resUser2 = await makeSimulatedRequest('GET', '/workspaces', {
    authorization: `Bearer ${tokenUser2}`
  });

  assert.equal(resUser2.status, 200);
  assert.ok(Array.isArray(resUser2.body.workspaces));
  assert.equal(resUser2.body.workspaces.length, 1);
  const wsUser2 = resUser2.body.workspaces[0];
  assert.match(wsUser2.name, /Seconduser Independent/i);

  // Verify that User 2 can also explicitly create a second workspace
  const createRes = await makeSimulatedRequest(
    'POST',
    '/workspaces',
    { authorization: `Bearer ${tokenUser2}` },
    { name: 'User 2 Secondary Workspace', description: 'Explicitly created' }
  );

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.workspace.name, 'User 2 Secondary Workspace');
});

test('TEST C: Repeated requests do not create duplicate workspaces or memberships', async () => {
  const tokenUser1 = createSignedTestToken({
    userId: 'user-repeat-777',
    email: 'repeatuser@example.com'
  });

  // Call GET /workspaces three times sequentially
  const res1 = await makeSimulatedRequest('GET', '/workspaces', { authorization: `Bearer ${tokenUser1}` });
  const res2 = await makeSimulatedRequest('GET', '/workspaces', { authorization: `Bearer ${tokenUser1}` });
  const res3 = await makeSimulatedRequest('GET', '/workspaces', { authorization: `Bearer ${tokenUser1}` });

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.equal(res3.status, 200);

  const initialWsId = res1.body.workspaces[0].id;
  assert.equal(res2.body.workspaces[0].id, initialWsId, 'Repeated call 2 must return the existing workspace ID');
  assert.equal(res3.body.workspaces[0].id, initialWsId, 'Repeated call 3 must return the existing workspace ID');
});

test('TEST D: Returning users retrieve their existing workspace', async () => {
  const token = createSignedTestToken({
    userId: 'user-returning-666',
    email: 'returning.executive@company.org'
  });

  // First session
  const session1 = await makeSimulatedRequest('GET', '/workspaces', { authorization: `Bearer ${token}` });
  assert.equal(session1.status, 200);
  const wsId = session1.body.workspaces[0].id;

  // Simulate returning user session after time delay or page refresh
  const session2 = await makeSimulatedRequest('GET', '/workspaces', { authorization: `Bearer ${token}` });
  assert.equal(session2.status, 200);
  assert.equal(session2.body.workspaces.length, 1);
  assert.equal(session2.body.workspaces[0].id, wsId);
});

test('TEST E: An unauthenticated request cannot create or view a workspace', async () => {
  const getRes = await makeSimulatedRequest('GET', '/workspaces', {});
  assert.equal(getRes.status, 401, 'GET /workspaces without auth token must be rejected with 401');

  const postRes = await makeSimulatedRequest('POST', '/workspaces', {}, { name: 'Unauthorized Workspace' });
  assert.equal(postRes.status, 401, 'POST /workspaces without auth token must be rejected with 401');
});

test('TEST F: A user cannot access another user workspace by changing the workspace ID', async () => {
  const tokenUserA = createSignedTestToken({
    userId: 'user-tenant-a',
    email: 'usera@company-a.com'
  });
  const tokenUserB = createSignedTestToken({
    userId: 'user-tenant-b',
    email: 'userb@company-b.com'
  });

  // Get User A workspace
  const wsResA = await makeSimulatedRequest('GET', '/workspaces', { authorization: `Bearer ${tokenUserA}` });
  const workspaceIdA = wsResA.body.workspaces[0].id;

  // User B attempts to access User A clients or leads using User A's workspace ID
  const accessRes = await makeSimulatedRequest(
    'GET',
    `/workspaces/${workspaceIdA}/clients`,
    { authorization: `Bearer ${tokenUserB}` }
  );

  assert.equal(accessRes.status, 403, 'Cross-tenant workspace access attempt must be rejected with HTTP 403 Forbidden');
  assert.match(accessRes.body.error || '', /Access denied/i);
});

test('TEST G: An authenticated user whose email is not on any allowlist can still initialize their workspace', async () => {
  // Pass an arbitrary, non-predefined email address
  const randomEmail = `unauthorized-list-user-${Date.now()}@random-domain-xyz.io`;
  const token = createSignedTestToken({
    userId: `uid-${Date.now()}`,
    email: randomEmail
  });

  // Verify server token verification succeeds
  const authRes = await verifyServerAuthToken({
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(authRes.status, 200);
  assert.equal(authRes.user?.email, randomEmail);

  // Verify workspace initialization succeeds
  const wsRes = await makeSimulatedRequest('GET', '/workspaces', { authorization: `Bearer ${token}` });
  assert.equal(wsRes.status, 200);
  assert.equal(wsRes.body.workspaces.length, 1);
});

test('TEST H: Invalid payload or empty workspace name returns explicit error instead of silent failure', async () => {
  const token = createSignedTestToken({
    userId: 'user-invalid-test',
    email: 'validuser@domain.com'
  });

  const res = await makeSimulatedRequest(
    'POST',
    '/workspaces',
    { authorization: `Bearer ${token}` },
    { name: '   ' }
  );

  assert.equal(res.status, 400);
  assert.match(res.body.error || '', /Workspace name is required/i);
});

test('TEST I: Existing authorized users retain access to their existing workspaces', async () => {
  const tokenSoham = createSignedTestToken({
    userId: 'user-sohamkharat481',
    email: 'sohamkharat481@gmail.com'
  });

  const res = await makeSimulatedRequest('GET', '/workspaces', { authorization: `Bearer ${tokenSoham}` });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.workspaces));
  assert.ok(res.body.workspaces.length >= 1);
});
