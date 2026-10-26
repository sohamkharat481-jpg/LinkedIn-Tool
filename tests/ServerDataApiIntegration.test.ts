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

test('5. Lead creation, retrieval, status update, and client lead count persist accurately via API', async () => {
  const tenantUser = 'user-leads-persist';
  const tenantWs = 'ws-leads-persist-e2e';
  registerWorkspaceAuthorization(tenantUser, tenantWs);

  const token = createSignedTestToken({ userId: tenantUser, email: 'leads@persist.com' });

  // 1. Create client
  const resClient = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'Persisted Tech Inc',
      niche: 'AI SaaS',
      notes: 'Testing lead persistence'
    })
  });
  assert.equal(resClient.status, 201);
  const clientData = await resClient.json();
  const clientId = clientData.client.id;

  // 2. Post leads
  const testLead = {
    id: '11111111-2222-3333-4444-555555555555',
    fullName: 'Jane Doe',
    headline: 'CTO at CloudTech',
    currentJobTitle: 'CTO',
    companyName: 'CloudTech',
    location: 'San Francisco, CA',
    profileUrl: 'https://linkedin.com/in/janedoe-persist-test',
    connectionsOrFollowers: '500+ connections',
    lastActivityDate: '2026-10-26',
    source: 'Wikidata SPARQL Query Service'
  };

  const resSaveLeads = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      clientId,
      leads: [testLead]
    })
  });
  assert.equal(resSaveLeads.status, 200);
  const saveLeadsData = await resSaveLeads.json();
  assert.equal(saveLeadsData.success, true);
  assert.equal(saveLeadsData.added, 1);

  // 3. Retrieve leads via GET /leads
  const resGetLeads = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/leads`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(resGetLeads.status, 200);
  const getLeadsData = await resGetLeads.json();
  assert.ok(getLeadsData.leads.some((l: any) => l.profileUrl === testLead.profileUrl));

  // 4. Check client leadsCount is updated
  const resClients = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/clients`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const clientsData = await resClients.json();
  const foundClient = clientsData.clients.find((c: any) => c.id === clientId);
  assert.ok(foundClient);
  assert.equal(foundClient.leadsCount, 1);

  // 5. Update lead status
  const resStatus = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/leads/${testLead.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ status: 'Request Sent' })
  });
  assert.equal(resStatus.status, 200);
});

test('6. Google Integrations and Export History endpoints persist and retrieve records', async () => {
  const tenantUser = 'user-google-export';
  const tenantWs = 'ws-google-export-e2e';
  const clientId = '22222222-3333-4444-5555-666666666666';
  registerWorkspaceAuthorization(tenantUser, tenantWs);

  const token = createSignedTestToken({ userId: tenantUser, email: 'export@google.com' });

  // 1. Save Google Integration
  const resSaveInt = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/google-integrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      clientId,
      spreadsheetId: 'sheet-abc-123',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc-123',
      sheetTitle: 'Export Sheet 1'
    })
  });
  assert.equal(resSaveInt.status, 201);

  // 2. Retrieve Google Integration
  const resGetInt = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/google-integrations?clientId=${clientId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(resGetInt.status, 200);
  const getIntData = await resGetInt.json();
  assert.equal(getIntData.integration?.spreadsheetId, 'sheet-abc-123');

  // 3. Save Export History
  const resSaveExp = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/export-history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      clientId,
      spreadsheetId: 'sheet-abc-123',
      exportedLeadsCount: 25,
      skippedDuplicatesCount: 2,
      exportedByEmail: 'export@google.com'
    })
  });
  assert.equal(resSaveExp.status, 201);

  // 4. Retrieve Export History
  const resGetExp = await fetch(`${baseUrl}/api/workspaces/${tenantWs}/export-history?clientId=${clientId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(resGetExp.status, 200);
  const getExpData = await resGetExp.json();
  assert.ok(getExpData.history.some((h: any) => h.spreadsheetId === 'sheet-abc-123' && h.exportedLeadsCount === 25));
});

test('7. Cross-tenant isolation strictly blocks unauthorized access to leads, searches, integrations, and export history', async () => {
  const userTenantA = 'user-sec-a';
  const wsA = 'ws-sec-a-iso';
  const userTenantB = 'user-sec-b';
  const wsB = 'ws-sec-b-iso';

  registerWorkspaceAuthorization(userTenantA, wsA);
  registerWorkspaceAuthorization(userTenantB, wsB);

  const tokenB = createSignedTestToken({ userId: userTenantB, email: 'attacker@tenantb.com' });

  // User B attempts to read User A's leads -> 403 Forbidden
  const resLeads = await fetch(`${baseUrl}/api/workspaces/${wsA}/leads`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(resLeads.status, 403);

  // User B attempts to post leads into User A's workspace -> 403 Forbidden
  const resPostLeads = await fetch(`${baseUrl}/api/workspaces/${wsA}/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenB}`
    },
    body: JSON.stringify({
      clientId: 'fake-client',
      leads: []
    })
  });
  assert.equal(resPostLeads.status, 403);

  // User B attempts to read User A's searches -> 403 Forbidden
  const resSearches = await fetch(`${baseUrl}/api/workspaces/${wsA}/searches`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(resSearches.status, 403);

  // User B attempts to read User A's google integrations -> 403 Forbidden
  const resInt = await fetch(`${baseUrl}/api/workspaces/${wsA}/google-integrations?clientId=any`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(resInt.status, 403);

  // User B attempts to read User A's export history -> 403 Forbidden
  const resExp = await fetch(`${baseUrl}/api/workspaces/${wsA}/export-history`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(resExp.status, 403);
});
