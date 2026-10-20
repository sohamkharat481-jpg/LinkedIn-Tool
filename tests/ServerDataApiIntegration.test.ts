import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import http from 'node:http';
import express from 'express';
import { apiRouter } from '../src/server/apiHandler';
import {
  createSignedTestToken,
  registerWorkspaceAuthorization,
  clearWorkspaceAuthorizations
} from '../src/server/serverAuthService';
import { SupabaseDataService, setAuthTokenProvider } from '../src/services/supabaseDataService';
import { dbService } from '../src/services/storage';

let server: http.Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      baseUrl = `http://127.0.0.1:${address.port}`;
      process.env.VITE_API_BASE_URL = baseUrl;
      resolve();
    });
  });
});

after(() => {
  if (server) {
    server.close();
  }
  delete process.env.VITE_API_BASE_URL;
  setAuthTokenProvider(null);
  clearWorkspaceAuthorizations();
});

test('1. API data routes reject requests with missing or invalid tokens with 401', async () => {
  const testWs = 'ws-sec-test-401';

  // Missing Authorization header
  const resMissing = await fetch(`${baseUrl}/api/workspaces/${testWs}/clients`);
  assert.equal(resMissing.status, 401);
  const dataMissing = await resMissing.json();
  assert.match(dataMissing.error || '', /Missing Authorization header/i);

  // Malformed header
  const resMalformed = await fetch(`${baseUrl}/api/workspaces/${testWs}/clients`, {
    headers: { Authorization: 'Basic invalid-token-here' }
  });
  assert.equal(resMalformed.status, 401);
  const dataMalformed = await resMalformed.json();
  assert.match(dataMalformed.error || '', /Bearer/i);

  // Invalid JWT signature
  const fakeToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTAwMSJ9.badsignature';
  const resInvalid = await fetch(`${baseUrl}/api/workspaces/${testWs}/clients`, {
    headers: { Authorization: `Bearer ${fakeToken}` }
  });
  assert.equal(resInvalid.status, 401);
});

test('2. API data routes reject cross-workspace access attempts with 403 Forbidden', async () => {
  clearWorkspaceAuthorizations();

  const userA = 'user-auth-alice';
  const userB = 'user-auth-bob';
  const workspaceA = 'ws-tenant-alice-secure';
  const workspaceB = 'ws-tenant-bob-secure';

  registerWorkspaceAuthorization(userA, workspaceA);
  registerWorkspaceAuthorization(userB, workspaceB);

  const tokenAlice = createSignedTestToken({ userId: userA, email: 'alice@company-a.com' });

  // Alice accesses Workspace A -> 200 OK
  const resAliceToA = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/clients`, {
    headers: { Authorization: `Bearer ${tokenAlice}` }
  });
  assert.equal(resAliceToA.status, 200);

  // Alice attempts to access Bob's Workspace B -> 403 Forbidden
  const resAliceToB = await fetch(`${baseUrl}/api/workspaces/${workspaceB}/clients`, {
    headers: { Authorization: `Bearer ${tokenAlice}` }
  });
  assert.equal(resAliceToB.status, 403);
  const dataAliceToB = await resAliceToB.json();
  assert.match(dataAliceToB.error || '', /Access denied/i);

  // Alice attempts to create client in Bob's Workspace B -> 403 Forbidden
  const resPostCross = await fetch(`${baseUrl}/api/workspaces/${workspaceB}/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAlice}`
    },
    body: JSON.stringify({ name: 'Hacked Client', niche: 'Exploit' })
  });
  assert.equal(resPostCross.status, 403);
});

test('3. Client create, list, update, and delete work end-to-end through API with tenant isolation', async () => {
  const tenantUser = 'user-tenant-corp';
  const tenantWs = 'ws-tenant-corp-e2e';
  registerWorkspaceAuthorization(tenantUser, tenantWs);

  const token = createSignedTestToken({ userId: tenantUser, email: 'corp@tenant.com' });

  // 1. Create client
  const resCreate = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'Alpha Quantum Logistics',
      niche: 'Supply Chain AI',
      notes: 'Series B client'
    })
  });
  assert.equal(resCreate.status, 201);
  const createData = await resCreate.json();
  assert.ok(createData.client?.id);
  assert.equal(createData.client.name, 'Alpha Quantum Logistics');
  const clientId = createData.client.id;

  // 2. List clients
  const resList = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/clients`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(resList.status, 200);
  const listData = await resList.json();
  assert.ok(listData.clients.some((c: any) => c.id === clientId));

  // 3. Update client
  const resUpdate = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/clients/${clientId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'Alpha Quantum Logistics Enterprise',
      notes: 'Upgraded to Enterprise'
    })
  });
  assert.equal(resUpdate.status, 200);
  const updateData = await resUpdate.json();
  assert.equal(updateData.client.name, 'Alpha Quantum Logistics Enterprise');

  // 4. Delete client
  const resDelete = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/clients/${clientId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(resDelete.status, 200);

  // 5. Verify deleted from list
  const resAfterDelete = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/clients`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const afterDeleteData = await resAfterDelete.json();
  assert.ok(!afterDeleteData.clients.some((c: any) => c.id === clientId));
});

test('4. Frontend SupabaseDataService seamlessly routes operations through authenticated API', async () => {
  const serviceUser = 'user-frontend-service';
  const serviceWs = 'ws-frontend-service-test';
  registerWorkspaceAuthorization(serviceUser, serviceWs);

  const token = createSignedTestToken({ userId: serviceUser, email: 'service@leadfinder.app' });
  setAuthTokenProvider(() => token);

  // Create client via SupabaseDataService (routes through API)
  const client = await SupabaseDataService.createClient(
    serviceWs,
    'Apex Financial Advisory',
    'Wealth Management',
    'High-net-worth individual leads'
  );

  assert.ok(client.id);
  assert.equal(client.name, 'Apex Financial Advisory');
  assert.equal(client.workspaceId, serviceWs);

  // List clients via SupabaseDataService
  const clients = await SupabaseDataService.getClients(serviceWs);
  assert.ok(clients.some((c) => c.id === client.id));

  // Update client
  const updated = await SupabaseDataService.updateClient(serviceWs, client.id, {
    name: 'Apex Global Financial Advisory'
  });
  assert.equal(updated.name, 'Apex Global Financial Advisory');

  // Save search record via SupabaseDataService
  const searchRecord = await SupabaseDataService.saveSearchRecord(
    serviceWs,
    client.id,
    client.name,
    { jobTitles: ['Managing Director'], industry: ['Finance'], country: 'US', seniority: [], companySize: [], maxLeads: 10 },
    15,
    12,
    3,
    12,
    'service@leadfinder.app'
  );
  assert.ok(searchRecord.id);
  assert.equal(searchRecord.clientName, client.name);

  // Get searches via SupabaseDataService
  const searches = await SupabaseDataService.getSearches(serviceWs);
  assert.ok(searches.some((s) => s.id === searchRecord.id));

  // Delete client
  await SupabaseDataService.deleteClient(serviceWs, client.id);
  const remainingClients = await SupabaseDataService.getClients(serviceWs);
  assert.ok(!remainingClients.some((c) => c.id === client.id));
});
