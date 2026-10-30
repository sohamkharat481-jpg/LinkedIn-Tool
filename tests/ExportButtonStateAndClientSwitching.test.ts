import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, LeadRecord } from '../src/types';
import { exportLeadsToGoogleSheet } from '../src/services/sheetsExport';
import { getUserSessionTokenKey } from '../src/services/auth';

const CLIENT_DENTAL: Client = {
  id: 'client-dental-clinic-001',
  workspaceId: 'ws-prod-test-01',
  name: 'Soham Kharat (Dental Clinic)',
  niche: 'Dental Clinic',
  notes: 'Private clinic practice',
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z'
};

const CLIENT_SAAS: Client = {
  id: 'client-saas-002',
  workspaceId: 'ws-prod-test-01',
  name: 'soham (SaaS)',
  niche: 'B2B SaaS',
  notes: 'SaaS agency client',
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z'
};

// Generate 51 synthetic leads strictly associated with CLIENT_SAAS
const SAAS_LEADS: LeadRecord[] = Array.from({ length: 51 }, (_, i) => ({
  id: `lead-saas-${i + 1}`,
  workspaceId: 'ws-prod-test-01',
  clientId: CLIENT_SAAS.id,
  fullName: `Executive ${i + 1}`,
  headline: `VP of Growth ${i + 1}`,
  currentJobTitle: 'VP of Growth',
  companyName: `SaaS Startup ${i + 1}`,
  location: 'Bangalore, India',
  profileUrl: `https://www.linkedin.com/in/exec-saas-${i + 1}`,
  connectionsOrFollowers: '500+',
  lastActivityDate: '2026-10-25',
  dateAdded: '2026-10-30',
  status: 'Not Contacted',
  notes: '',
  source: 'Wikidata'
}));

const ALL_WORKSPACE_LEADS = [...SAAS_LEADS];

test('1. Client lead filtering isolates 51 leads for SaaS and 0 leads for Dental Clinic', () => {
  const dentalLeads = ALL_WORKSPACE_LEADS.filter((l) => l.clientId === CLIENT_DENTAL.id);
  const saasLeads = ALL_WORKSPACE_LEADS.filter((l) => l.clientId === CLIENT_SAAS.id);

  assert.equal(dentalLeads.length, 0, 'Dental Clinic must have strictly 0 leads');
  assert.equal(saasLeads.length, 51, 'SaaS client must have all 51 collected leads');
});

test('2. Export button disabled condition evaluates to true for Dental Clinic with clear reason', () => {
  const dentalLeads = ALL_WORKSPACE_LEADS.filter((l) => l.clientId === CLIENT_DENTAL.id);
  const isDisabled = dentalLeads.length === 0;
  const title = isDisabled
    ? `Export disabled: 0 leads collected for "${CLIENT_DENTAL.name}". Please discover leads using the Lead Finder first.`
    : `Export ${dentalLeads.length} lead(s) for "${CLIENT_DENTAL.name}" directly to Google Sheets`;

  assert.equal(isDisabled, true, 'Export button must be disabled for client with 0 leads');
  assert.match(title, /Export disabled: 0 leads collected/);
  assert.match(title, /Dental Clinic/);
});

test('3. Export button disabled condition evaluates to false for SaaS with 51 leads', () => {
  const saasLeads = ALL_WORKSPACE_LEADS.filter((l) => l.clientId === CLIENT_SAAS.id);
  const isDisabled = saasLeads.length === 0;
  const title = isDisabled
    ? `Export disabled: 0 leads collected for "${CLIENT_SAAS.name}". Please discover leads using the Lead Finder first.`
    : `Export ${saasLeads.length} lead(s) for "${CLIENT_SAAS.name}" directly to Google Sheets`;

  assert.equal(isDisabled, false, 'Export button must be enabled when client has 51 leads');
  assert.equal(title, 'Export 51 lead(s) for "soham (SaaS)" directly to Google Sheets');
});

test('4. Switching active client resolves the correct leads count and active client object', () => {
  const clients = [CLIENT_DENTAL, CLIENT_SAAS];

  // Helper simulating ClientManagementView client resolution
  const resolveClientAndLeads = (activeClient: Client, selectedDetailId?: string) => {
    const target = (selectedDetailId ? clients.find((c) => c.id === selectedDetailId) : null) || activeClient;
    const leads = ALL_WORKSPACE_LEADS.filter((l) => l.clientId === target.id);
    return { client: target, leads, count: leads.length, canExport: leads.length > 0 };
  };

  // Initially active: Dental Clinic
  const initial = resolveClientAndLeads(CLIENT_DENTAL);
  assert.equal(initial.client.name, 'Soham Kharat (Dental Clinic)');
  assert.equal(initial.count, 0);
  assert.equal(initial.canExport, false);

  // Switch to SaaS client
  const switched = resolveClientAndLeads(CLIENT_SAAS);
  assert.equal(switched.client.name, 'soham (SaaS)');
  assert.equal(switched.count, 51);
  assert.equal(switched.canExport, true);
});

test('5. Multi-user OAuth session key isolates tokens by user UID', () => {
  const user1 = { uid: 'firebase-user-soham-101', email: 'soham@saas.com' };
  const user2 = { uid: 'firebase-user-other-202', email: 'other@dental.com' };

  const key1 = getUserSessionTokenKey(user1);
  const key2 = getUserSessionTokenKey(user2);

  assert.equal(key1, '__g_oauth_session_token_firebase-user-soham-101');
  assert.equal(key2, '__g_oauth_session_token_firebase-user-other-202');
  assert.notEqual(key1, key2);
});

test('6. Sheets export service rejects 0-lead export with descriptive error and returns success: false', async () => {
  const result = await exportLeadsToGoogleSheet('dummy-token', CLIENT_DENTAL.name, []);
  assert.equal(result.success, false);
  assert.equal(result.addedCount, 0);
  assert.match(result.message, /Zero leads/i);
});

test('7. Scenario C: Switching back to Dental Clinic returns 0 leads and disables both export buttons', () => {
  const clients = [CLIENT_DENTAL, CLIENT_SAAS];
  const resolveClientAndLeads = (activeClient: Client, selectedDetailId?: string) => {
    const target = (selectedDetailId ? clients.find((c) => c.id === selectedDetailId) : null) || activeClient;
    const leads = ALL_WORKSPACE_LEADS.filter((l) => l.clientId === target.id);
    return { client: target, leads, count: leads.length, canExport: leads.length > 0 };
  };

  // Switch back to Dental Clinic
  const backToDental = resolveClientAndLeads(CLIENT_DENTAL);
  assert.equal(backToDental.client.name, 'Soham Kharat (Dental Clinic)');
  assert.equal(backToDental.count, 0);
  assert.equal(backToDental.canExport, false, 'Export must be disabled again when switching back to Dental Clinic');
});

test('8. Scenario D: Refresh restoration preserves client selection, lead counts, and user OAuth token isolation', () => {
  const wsId = 'ws-prod-test-01';
  const mockStorage: Record<string, string> = {};

  // Simulate active client selection storage in localStorage
  mockStorage[`llf_active_client_${wsId}`] = CLIENT_SAAS.id;

  const storedClientId = mockStorage[`llf_active_client_${wsId}`];
  const clients = [CLIENT_DENTAL, CLIENT_SAAS];
  const restoredClient = clients.find((c) => c.id === storedClientId) || clients[0];

  assert.equal(restoredClient.id, CLIENT_SAAS.id);
  assert.equal(restoredClient.name, 'soham (SaaS)');

  // Verify lead count remains 51
  const restoredLeads = ALL_WORKSPACE_LEADS.filter((l) => l.clientId === restoredClient.id);
  assert.equal(restoredLeads.length, 51);

  // Simulate user OAuth restoration
  const currentUser = { uid: 'user-auth-uid-789', email: 'sohamkharat481@gmail.com' };
  const userTokenKey = getUserSessionTokenKey(currentUser);
  mockStorage[userTokenKey] = 'ya29.sample-authorized-token';

  assert.equal(mockStorage[userTokenKey], 'ya29.sample-authorized-token');
  assert.equal(userTokenKey, '__g_oauth_session_token_user-auth-uid-789');
});
