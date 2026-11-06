
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('Automated Schema Compatibility Test - Check DB columns vs Payload definitions', async () => {
  console.log('[Schema Test] Auditing schema definitions and payload builders...');

  // 1. Read supabase_schema.sql to inspect table definitions
  const schemaPath = path.resolve(process.cwd(), 'supabase_schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.leads'), 'leads table defined in schema');
  assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.client_leads'), 'client_leads table defined in schema');
  assert.ok(schemaSql.includes('workspace_id'), 'workspace_id column present');

  // 2. Read dataRoutes.ts to check prepareLeadPayload and fallback columns
  const dataRoutesPath = path.resolve(process.cwd(), 'src/server/dataRoutes.ts');
  const dataRoutesCode = fs.readFileSync(dataRoutesPath, 'utf8');

  assert.ok(dataRoutesCode.includes('CORE_LEAD_COLUMNS'), 'CORE_LEAD_COLUMNS fallback defined');
  assert.ok(dataRoutesCode.includes('prepareLeadPayload'), 'prepareLeadPayload helper defined');
  assert.ok(dataRoutesCode.includes('minimal'), 'minimal payload fallback supported');

  // 3. Verify that coreBase does not include seniority or organization_id
  const coreBaseIdx = dataRoutesCode.indexOf('const coreBase = {');
  const coreBaseSnippet = dataRoutesCode.substring(coreBaseIdx, coreBaseIdx + 400);

  assert.ok(!coreBaseSnippet.includes('organization_id'), 'organization_id excluded from coreBase');
  assert.ok(!coreBaseSnippet.includes('seniority:'), 'seniority excluded from coreBase so minimal fallback succeeds');

  console.log('[Schema Test] ✅ All schema compatibility assertions passed successfully.');
});
