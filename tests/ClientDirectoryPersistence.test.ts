import assert from 'node:assert/strict';
import test from 'node:test';
import { dbService } from '../src/services/storage';
import { SupabaseDataService } from '../src/services/supabaseDataService';
import { Client } from '../src/types';

test('1. Client creation validates required parameters and throws on empty input', async () => {
  await assert.rejects(
    async () => {
      await SupabaseDataService.createClient('', 'Test Name', 'Niche', 'Notes');
    },
    /Workspace ID is required/
  );

  await assert.rejects(
    async () => {
      await SupabaseDataService.createClient('ws-valid-id', '', 'Niche', 'Notes');
    },
    /Client name is required/
  );

  await assert.rejects(
    async () => {
      await SupabaseDataService.createClient('ws-valid-id', 'Test Name', '', 'Notes');
    },
    /Business \/ Niche is required/
  );
});

test('2. Successfully created client appears immediately in workspace client directory', async () => {
  const testWsId = 'ws-test-persistence-01';
  const name = 'Meridian Health Tech';
  const niche = 'HealthTech SaaS';
  const notes = 'Targeting CTOs in North America';

  const created = await SupabaseDataService.createClient(testWsId, name, niche, notes);

  assert.ok(created.id);
  assert.equal(created.workspaceId, testWsId);
  assert.equal(created.name, name);
  assert.equal(created.niche, niche);
  assert.equal(created.notes, notes);

  // Verify immediate retrieval
  const clients = await SupabaseDataService.getClients(testWsId);
  const found = clients.find((c) => c.id === created.id);

  assert.ok(found, 'Created client should appear immediately in directory');
  assert.equal(found?.name, name);
  assert.equal(found?.niche, niche);
});

test('3. Client remains visible across reload and repeated fetches', async () => {
  const testWsId = 'ws-test-reload-02';
  const created = await SupabaseDataService.createClient(testWsId, 'Apex Robotics', 'Industrial AI', 'Series A');

  // First fetch (initial render)
  const firstFetch = await SupabaseDataService.getClients(testWsId);
  assert.equal(firstFetch.length, 1);
  assert.equal(firstFetch[0].id, created.id);

  // Second fetch (simulating page refresh / navigation)
  const secondFetch = await SupabaseDataService.getClients(testWsId);
  assert.equal(secondFetch.length, 1);
  assert.equal(secondFetch[0].id, created.id);
  assert.equal(secondFetch[0].name, 'Apex Robotics');
});

test('4. Workspace isolation ensures clients belong strictly to their assigned workspace', async () => {
  const wsA = 'ws-isolated-tenant-a';
  const wsB = 'ws-isolated-tenant-b';

  const clientA = await SupabaseDataService.createClient(wsA, 'Client for Tenant A', 'Fintech', '');
  const clientB = await SupabaseDataService.createClient(wsB, 'Client for Tenant B', 'Logistics', '');

  const listA = await SupabaseDataService.getClients(wsA);
  const listB = await SupabaseDataService.getClients(wsB);

  // Verify Tenant A sees only Client A
  assert.ok(listA.some((c) => c.id === clientA.id));
  assert.ok(!listA.some((c) => c.id === clientB.id));

  // Verify Tenant B sees only Client B
  assert.ok(listB.some((c) => c.id === clientB.id));
  assert.ok(!listB.some((c) => c.id === clientA.id));
});

test('5. Empty workspace returns empty client list without injecting fake demo clients', async () => {
  const emptyWsId = 'ws-empty-fresh-workspace';
  const clients = await SupabaseDataService.getClients(emptyWsId);

  assert.deepEqual(clients, [], 'A fresh workspace must have 0 clients and no fake fallback clients');
});

test('6. Client updates and deletions persist correctly within workspace scope', async () => {
  const testWsId = 'ws-crud-lifecycle';
  const client = await SupabaseDataService.createClient(testWsId, 'Original Name', 'Initial Niche', 'Old notes');

  // Update
  const updated = await SupabaseDataService.updateClient(testWsId, client.id, {
    name: 'Updated Name',
    niche: 'Updated Niche',
    notes: 'New notes'
  });

  assert.equal(updated.name, 'Updated Name');
  assert.equal(updated.niche, 'Updated Niche');

  const afterUpdate = await SupabaseDataService.getClients(testWsId);
  assert.equal(afterUpdate[0].name, 'Updated Name');

  // Delete
  await SupabaseDataService.deleteClient(testWsId, client.id);
  const afterDelete = await SupabaseDataService.getClients(testWsId);
  assert.equal(afterDelete.length, 0);
});

test('7. Cache synchronization accurately updates local cache without data loss across workspaces', async () => {
  const ws1 = 'ws-sync-cache-1';
  const ws2 = 'ws-sync-cache-2';

  const client1 = await SupabaseDataService.createClient(ws1, 'Sync Client 1', 'Niche 1', '');
  const client2 = await SupabaseDataService.createClient(ws2, 'Sync Client 2', 'Niche 2', '');

  // Verify storage cache
  const cached1 = dbService.getClients(ws1);
  const cached2 = dbService.getClients(ws2);

  assert.equal(cached1.length, 1);
  assert.equal(cached1[0].id, client1.id);

  assert.equal(cached2.length, 1);
  assert.equal(cached2[0].id, client2.id);

  // Sync with updated mock data from database
  const updatedMockClient1: Client = {
    ...client1,
    name: 'Synced Client 1 from Remote'
  };
  dbService.syncClientsForWorkspace(ws1, [updatedMockClient1]);

  const postSync1 = dbService.getClients(ws1);
  const postSync2 = dbService.getClients(ws2);

  assert.equal(postSync1[0].name, 'Synced Client 1 from Remote');
  assert.equal(postSync2[0].name, 'Sync Client 2', 'Workspace 2 cache must remain untouched');
});
