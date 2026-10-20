import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  createSignedTestToken,
  verifyServerAuthToken,
  registerWorkspaceAuthorization,
  clearWorkspaceAuthorizations,
  isUserAuthorizedForWorkspace,
  verifyWorkspaceAccess
} from '../src/server/serverAuthService';
import { SupabaseDataService } from '../src/services/supabaseDataService';
import { dbService } from '../src/services/storage';

test('1. Server token verification rejects missing, malformed, expired, or forged tokens', async () => {
  // Missing header
  const resMissing = await verifyServerAuthToken({});
  assert.equal(resMissing.status, 401);
  assert.match(resMissing.error || '', /Missing Authorization header/i);

  // Malformed header
  const resMalformed = await verifyServerAuthToken({
    headers: { authorization: 'Basic 123456' }
  });
  assert.equal(resMalformed.status, 401);
  assert.match(resMalformed.error || '', /Bearer/i);

  // Expired token
  const expiredToken = createSignedTestToken({
    userId: 'user-expired-01',
    exp: Math.floor(Date.now() / 1000) - 100 // expired in past
  });
  const resExpired = await verifyServerAuthToken({
    headers: { authorization: `Bearer ${expiredToken}` }
  });
  assert.equal(resExpired.status, 401);
  assert.match(resExpired.error || '', /expired/i);

  // Forged/tampered signature
  const validToken = createSignedTestToken({ userId: 'user-valid-01' });
  const parts = validToken.split('.');
  const forgedToken = `${parts[0]}.${parts[1]}.badsignature12345`;
  const resForged = await verifyServerAuthToken({
    headers: { authorization: `Bearer ${forgedToken}` }
  });
  assert.equal(resForged.status, 401);
  assert.match(resForged.error || '', /signature/i);

  // Valid token
  const resValid = await verifyServerAuthToken({
    headers: { authorization: `Bearer ${validToken}` }
  });
  assert.equal(resValid.status, 200);
  assert.equal(resValid.user?.userId, 'user-valid-01');
});

test('2. Server rejects cross-workspace access attempts without valid tenancy authorization', async () => {
  clearWorkspaceAuthorizations();

  const userA = 'user-tenant-alice';
  const userB = 'user-tenant-bob';
  const workspaceA = 'ws-tenant-alice-org';
  const workspaceB = 'ws-tenant-bob-org';

  // Authorize User A for Workspace A, User B for Workspace B
  registerWorkspaceAuthorization(userA, workspaceA);
  registerWorkspaceAuthorization(userB, workspaceB);

  // User A requesting Workspace A -> Authorized
  const isAforA = await isUserAuthorizedForWorkspace(userA, workspaceA);
  assert.equal(isAforA, true, 'User A should be authorized for Workspace A');

  // User A requesting Workspace B (Cross-workspace attempt) -> Forbidden
  const isAforB = await isUserAuthorizedForWorkspace(userA, workspaceB);
  assert.equal(isAforB, false, 'User A MUST NOT be authorized for Workspace B');

  // User B requesting Workspace A (Cross-workspace attempt) -> Forbidden
  const isBforA = await isUserAuthorizedForWorkspace(userB, workspaceA);
  assert.equal(isBforA, false, 'User B MUST NOT be authorized for Workspace A');

  // Test full request verification flow with JWT
  const tokenA = createSignedTestToken({ userId: userA, email: 'alice@tenant-a.com' });

  // Alice accesses Workspace A -> 200
  const reqAtoA = { headers: { authorization: `Bearer ${tokenA}` } };
  const accessAtoA = await verifyWorkspaceAccess(reqAtoA, workspaceA);
  assert.equal(accessAtoA.status, 200);
  assert.equal(accessAtoA.authorized, true);

  // Alice attempts to access Bob's Workspace B -> 403 Forbidden
  const accessAtoB = await verifyWorkspaceAccess(reqAtoA, workspaceB);
  assert.equal(accessAtoB.status, 403);
  assert.equal(accessAtoB.authorized, false);
  assert.match(accessAtoB.error || '', /not authorized to access workspace/i);

  // Request with missing or blank workspaceId -> 400 Bad Request
  const accessNoWs = await verifyWorkspaceAccess(reqAtoA, '');
  assert.equal(accessNoWs.status, 400);
  assert.equal(accessNoWs.authorized, false);

  clearWorkspaceAuthorizations();
});

test('3. Schema and RLS policies audit: Enforces tenant isolation and rejects insecure workspace_id IS NOT NULL', () => {
  const schemaPath = path.resolve(process.cwd(), 'supabase_schema.sql');
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase_migrations/20261020_enhance_workspace_tenant_isolation_rls.sql'
  );

  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  const migrationContent = fs.readFileSync(migrationPath, 'utf8');

  // Verify that insecure policies like 'workspace_id IS NOT NULL' are NEVER used
  assert.ok(
    !schemaContent.includes('USING (workspace_id IS NOT NULL)'),
    'supabase_schema.sql must NEVER contain insecure "USING (workspace_id IS NOT NULL)" policy'
  );
  assert.ok(
    !migrationContent.includes('USING (workspace_id IS NOT NULL)'),
    'Migration must NEVER contain insecure "USING (workspace_id IS NOT NULL)" policy'
  );

  // Verify that WITH CHECK clauses are enforced for critical tables
  const criticalTables = ['workspaces', 'clients', 'lead_searches', 'leads', 'client_leads'];
  for (const table of criticalTables) {
    const policyPattern = new RegExp(`CREATE POLICY.*ON public\\.${table}[\\s\\S]*?WITH CHECK`, 'i');
    assert.ok(
      policyPattern.test(schemaContent),
      `public.${table} must have an explicit WITH CHECK clause in supabase_schema.sql`
    );
    assert.ok(
      policyPattern.test(migrationContent),
      `public.${table} must have an explicit WITH CHECK clause in migration`
    );
  }

  // Verify auth.uid() check is present
  assert.ok(schemaContent.includes('auth.uid()'), 'Schema must reference auth.uid() for identity resolution');
  assert.ok(migrationContent.includes('auth.uid()'), 'Migration must reference auth.uid() for identity resolution');
});

test('4. Cross-workspace client isolation prevents data leakage between tenants', async () => {
  const wsX = 'ws-cross-tenant-x-' + Date.now();
  const wsY = 'ws-cross-tenant-y-' + Date.now();

  // Create clients in Workspace X
  const clientX1 = await SupabaseDataService.createClient(wsX, 'Acme Corp X1', 'Cloud Infrastructure', 'Internal');
  const clientX2 = await SupabaseDataService.createClient(wsX, 'Apex Logistics X2', 'Freight Logistics', 'VIP');

  // Create client in Workspace Y
  const clientY1 = await SupabaseDataService.createClient(wsY, 'Cyberdyne Systems Y1', 'Defense AI', 'Confidential');

  // Query Workspace X
  const listX = await SupabaseDataService.getClients(wsX);
  assert.equal(listX.length, 2);
  assert.ok(listX.some((c) => c.id === clientX1.id));
  assert.ok(listX.some((c) => c.id === clientX2.id));
  assert.ok(!listX.some((c) => c.id === clientY1.id), 'Workspace X must never see Workspace Y clients');

  // Query Workspace Y
  const listY = await SupabaseDataService.getClients(wsY);
  assert.equal(listY.length, 1);
  assert.ok(listY.some((c) => c.id === clientY1.id));
  assert.ok(!listY.some((c) => c.id === clientX1.id), 'Workspace Y must never see Workspace X clients');

  // Attempting to delete Client X1 from Workspace Y scope
  await SupabaseDataService.deleteClient(wsY, clientX1.id);

  // Verify Client X1 still exists safely in Workspace X
  const checkX = await SupabaseDataService.getClients(wsX);
  assert.ok(checkX.some((c) => c.id === clientX1.id), 'Deleting from incorrect workspace must not delete client');

  // Clean up
  await SupabaseDataService.deleteClient(wsX, clientX1.id);
  await SupabaseDataService.deleteClient(wsX, clientX2.id);
  await SupabaseDataService.deleteClient(wsY, clientY1.id);
});

test('5. WITH CHECK simulation: Reject moving or inserting client into unauthorized workspace', async () => {
  const authorizedWs = 'ws-auth-permitted';
  const unauthorizedWs = 'ws-auth-forbidden';

  // Ensure invalid workspace ID is rejected at validation layer
  await assert.rejects(
    async () => {
      await SupabaseDataService.createClient('', 'Test Corp', 'Niche', '');
    },
    /Workspace ID is required/i
  );

  await assert.rejects(
    async () => {
      await SupabaseDataService.createClient('   ', 'Test Corp', 'Niche', '');
    },
    /Workspace ID is required/i
  );

  // Verify authorized client cannot be modified from unauthorized workspace context
  const client = await SupabaseDataService.createClient(authorizedWs, 'Secure Tenant Client', 'FinTech', 'Notes');

  // Attempt to update via unauthorized workspace context must throw access denied error
  assert.throws(
    () => dbService.updateClient(unauthorizedWs, client.id, { name: 'Hacked Name' }),
    /Client not found or access denied/i
  );

  // The client was not updated in the authorized workspace
  const pristine = dbService.getClients(authorizedWs).find((c) => c.id === client.id);
  assert.equal(pristine?.name, 'Secure Tenant Client', 'Client name in authorized workspace must not be modified');

  // Cleanup
  dbService.deleteClient(authorizedWs, client.id);
});
