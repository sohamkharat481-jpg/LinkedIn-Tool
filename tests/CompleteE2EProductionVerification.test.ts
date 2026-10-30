import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import http from 'node:http';
import express from 'express';
import { apiRouter } from '../src/server/apiHandler';
import {
  createSignedTestToken,
  registerWorkspaceAuthorization,
  clearWorkspaceAuthorizations,
  getDeterministicWorkspaceId
} from '../src/server/serverAuthService';
import { SupabaseDataService, setAuthTokenProvider } from '../src/services/supabaseDataService';
import { dbService } from '../src/services/storage';
import { WikidataLeadProvider } from '../src/services/leadProviders/WikidataLeadProvider';
import { exportLeadsToGoogleSheet } from '../src/services/sheetsExport';
import { getUserSessionTokenKey } from '../src/services/auth';
import { LeadRecord, LeadFilter, Client } from '../src/types';

let server: http.Server;
let baseUrl: string;

const USER_A = {
  uid: 'user-e2e-alice-uid-101',
  email: 'alice.founder@testcorp.com',
  name: 'Alice Founder'
};

const USER_B = {
  uid: 'user-e2e-bob-uid-202',
  email: 'bob.director@otherdomain.com',
  name: 'Bob Director'
};

let workspaceA: string;
let workspaceB: string;
let tokenA: string;
let tokenB: string;

let clientDentalId: string;
let clientSaaSId: string;

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

  // Deterministic workspaces
  workspaceA = getDeterministicWorkspaceId(USER_A.uid);
  workspaceB = getDeterministicWorkspaceId(USER_B.uid);

  registerWorkspaceAuthorization(USER_A.uid, workspaceA);
  registerWorkspaceAuthorization(USER_B.uid, workspaceB);

  tokenA = createSignedTestToken({ userId: USER_A.uid, email: USER_A.email });
  tokenB = createSignedTestToken({ userId: USER_B.uid, email: USER_B.email });
});

after(() => {
  if (server) {
    server.close();
  }
  delete process.env.VITE_API_BASE_URL;
  setAuthTokenProvider(null);
  clearWorkspaceAuthorizations();
});

// ==========================================
// PHASE 1 — AUTHENTICATION & WORKSPACE ISOLATION
// ==========================================
test('Phase 1.1: User A login returns their deterministic workspace and authorizes access', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.workspaces));
  assert.ok(data.workspaces.some((w: any) => w.id === workspaceA));
});

test('Phase 1.2: User B login returns separate deterministic workspace, isolated from User A', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.workspaces));
  assert.ok(data.workspaces.some((w: any) => w.id === workspaceB));
  assert.ok(!data.workspaces.some((w: any) => w.id === workspaceA));
});

test('Phase 1.3: User A and User B session tokens and workspaces persist deterministically', () => {
  const recomputedWsA = getDeterministicWorkspaceId(USER_A.uid);
  const recomputedWsB = getDeterministicWorkspaceId(USER_B.uid);
  assert.equal(recomputedWsA, workspaceA);
  assert.equal(recomputedWsB, workspaceB);
  assert.notEqual(recomputedWsA, recomputedWsB);
});

// ==========================================
// PHASE 2 — CLIENT MANAGEMENT
// ==========================================
test('Phase 2.1: Create client "Soham Kharat (Dental Clinic)" in Workspace A', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({
      name: 'Soham Kharat (Dental Clinic)',
      niche: 'Dental Clinic Healthcare',
      notes: 'Outreach to healthcare partners'
    })
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.client?.id);
  assert.equal(data.client.name, 'Soham Kharat (Dental Clinic)');
  clientDentalId = data.client.id;
});

test('Phase 2.2: Create client "soham (SaaS)" in Workspace A', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({
      name: 'soham (SaaS)',
      niche: 'B2B Software & SaaS',
      notes: 'Active client for targeted tech outreach'
    })
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.client?.id);
  assert.equal(data.client.name, 'soham (SaaS)');
  clientSaaSId = data.client.id;
});

test('Phase 2.3: Edit client details and verify persistence', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/clients/${clientSaaSId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({
      name: 'soham (SaaS)',
      niche: 'B2B Software & SaaS Enterprise',
      notes: 'Updated notes: Verified enterprise focus'
    })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.client.niche, 'B2B Software & SaaS Enterprise');
});

test('Phase 2.4: List clients and verify distinct IDs for both clients', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/clients`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.clients));
  assert.ok(data.clients.length >= 2);

  const dental = data.clients.find((c: any) => c.id === clientDentalId);
  const saas = data.clients.find((c: any) => c.id === clientSaaSId);

  assert.ok(dental, 'Dental client should exist');
  assert.ok(saas, 'SaaS client should exist');
  assert.notEqual(dental.id, saas.id);
});

// ==========================================
// PHASE 3 — LEAD GENERATION (GENUINE WIKIDATA SEARCH)
// ==========================================
let realGeneratedLeads: LeadRecord[] = [];
let searchIdSaaS: string;

test('Phase 3.1: Execute real search via WikidataLeadProvider for genuine executive leads', async () => {
  const provider = new WikidataLeadProvider();
  const filters: LeadFilter = {
    country: 'India',
    jobTitles: ['Founder', 'CEO', 'Director'],
    seniority: ['Director', 'C-Level'],
    industry: ['Technology & SaaS'],
    companySize: ['11-50', '51-200'],
    maxLeads: 10
  };

  const results = await provider.search(filters);
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0, `Expected real leads from Wikidata, got ${results.length}`);

  // Validate lead structure
  for (const lead of results) {
    assert.ok(lead.fullName && lead.fullName.length > 1);
    assert.ok(lead.profileUrl && lead.profileUrl.startsWith('http'));
  }

  realGeneratedLeads = results.map((r) => ({
    ...r,
    workspaceId: workspaceA,
    clientId: clientSaaSId
  }));
});

test('Phase 3.2: Persist genuine leads to "soham (SaaS)" and save search history', async () => {
  searchIdSaaS = '550e8400-e29b-41d4-a716-446655440000';

  // 1. Save leads
  const resLeads = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({
      clientId: clientSaaSId,
      leads: realGeneratedLeads,
      searchId: searchIdSaaS
    })
  });
  assert.equal(resLeads.status, 200);
  const dataLeads = await resLeads.json();
  assert.equal(dataLeads.success, true);
  assert.ok(dataLeads.added > 0);

  // 2. Save search history
  const resSearch = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/searches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({
      searchId: searchIdSaaS,
      clientId: clientSaaSId,
      clientName: 'soham (SaaS)',
      filters: { country: 'India', maxLeads: 10 },
      candidatesFound: realGeneratedLeads.length,
      validLeads: dataLeads.added,
      duplicatesRemoved: 0,
      finalLeadCount: dataLeads.added,
      createdBy: USER_A.email
    })
  });
  assert.equal(resSearch.status, 201);
  const dataSearch = await resSearch.json();
  assert.equal(dataSearch.search.id, searchIdSaaS);
});

test('Phase 3.3: Duplicate leads are handled and skipped without failure', async () => {
  const resDup = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({
      clientId: clientSaaSId,
      leads: realGeneratedLeads,
      searchId: searchIdSaaS
    })
  });
  assert.equal(resDup.status, 200);
  const dataDup = await resDup.json();
  assert.equal(dataDup.success, true);
  assert.equal(dataDup.added, 0);
  assert.equal(dataDup.duplicatesSkipped, realGeneratedLeads.length);
});

// ==========================================
// PHASE 4 — LEAD HISTORY AND ISOLATED LEADS
// ==========================================
test('Phase 4.1: Search history appears in workspace searches query', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/searches`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.searches));
  const foundSearch = data.searches.find((s: any) => s.id === searchIdSaaS);
  assert.ok(foundSearch, 'Search record should be found in history');
  assert.equal(foundSearch.clientId, clientSaaSId);
});

test('Phase 4.2: Client "soham (SaaS)" has collected leads, while "Dental Clinic" has 0', async () => {
  // Leads for SaaS
  const resSaaS = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/leads?clientId=${clientSaaSId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(resSaaS.status, 200);
  const dataSaaS = await resSaaS.json();
  assert.ok(Array.isArray(dataSaaS.leads));
  assert.ok(dataSaaS.leads.length > 0, 'SaaS client should have non-zero leads');

  // Leads for Dental Clinic
  const resDental = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/leads?clientId=${clientDentalId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(resDental.status, 200);
  const dataDental = await resDental.json();
  assert.ok(Array.isArray(dataDental.leads));
  assert.equal(dataDental.leads.length, 0, 'Dental Clinic client must have 0 leads (isolated)');
});

// ==========================================
// PHASE 5 — GOOGLE OAUTH ISOLATION
// ==========================================
test('Phase 5.1: getUserSessionTokenKey isolates OAuth token by user UID', () => {
  const keyAlice = getUserSessionTokenKey({ uid: USER_A.uid } as any);
  const keyBob = getUserSessionTokenKey({ uid: USER_B.uid } as any);

  assert.equal(keyAlice, `__g_oauth_session_token_${USER_A.uid}`);
  assert.equal(keyBob, `__g_oauth_session_token_${USER_B.uid}`);
  assert.notEqual(keyAlice, keyBob, 'Session token keys must be strictly isolated per user UID');
});

// ==========================================
// PHASE 6 — GOOGLE SHEETS EXPORT
// ==========================================
test('Phase 6.1: Authoritative export-leads endpoint returns verified leads for "soham (SaaS)"', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/clients/${clientSaaSId}/export-leads`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.leads));
  assert.ok(data.leads.length > 0, 'Authoritative export-leads endpoint must return non-zero leads');
  assert.equal(data.leads.length, realGeneratedLeads.length);
  assert.ok(data.diagnostics);
  assert.equal(data.diagnostics.exportQueryReturnedCount, data.leads.length);
});

test('Phase 6.2: Authoritative export-leads endpoint returns 0 leads for "Dental Clinic"', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/clients/${clientDentalId}/export-leads`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.leads));
  assert.equal(data.leads.length, 0, 'Dental Clinic must have 0 export leads');
});

test('Phase 6.3: Export rejects empty lead list with failure message', async () => {
  const res = await exportLeadsToGoogleSheet('dummy-token-abc', 'Empty Client', []);
  assert.equal(res.success, false);
  assert.match(res.message, /Zero leads/i);
});

// ==========================================
// PHASE 7 — MULTI-TENANT SECURITY
// ==========================================
test('Phase 7.1: User B attempting to access User A workspace clients is rejected with 403', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/clients`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(res.status, 403);
});

test('Phase 7.2: User B attempting to access User A leads is rejected with 403', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/leads`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(res.status, 403);
});

test('Phase 7.3: User B attempting to access User A export-leads is rejected with 403', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/clients/${clientSaaSId}/export-leads`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(res.status, 403);
});

test('Phase 7.4: User B attempting to access User A searches is rejected with 403', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/searches`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(res.status, 403);
});

test('Phase 7.5: User B attempting to access User A google-integrations is rejected with 403', async () => {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/google-integrations?clientId=${clientSaaSId}`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(res.status, 403);
});

// ==========================================
// PHASE 8 — REGRESSION TESTS
// ==========================================
test('Phase 8.1: Client leads status and notes updates work correctly within tenant boundary', async () => {
  const getRes = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/leads?clientId=${clientSaaSId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  const leadsData = await getRes.json();
  assert.ok(Array.isArray(leadsData.leads) && leadsData.leads.length > 0);
  const leadId = leadsData.leads[0].id;
  assert.ok(leadId, 'Lead must have a valid ID');

  const resStatus = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/leads/${leadId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ status: 'Contacted' })
  });
  assert.equal(resStatus.status, 200);

  const resNotes = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/leads/${leadId}/notes`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ notes: 'Follow up next Tuesday' })
  });
  assert.equal(resNotes.status, 200);
});
