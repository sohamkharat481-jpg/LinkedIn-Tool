import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LeadPersistenceWriter,
  persistLeadsAndLinks
} from '../src/services/supabaseDataService';

const localResult = { added: 2, duplicatesSkipped: 1 };
const persistedLeads = [
  { id: 'db-lead-1', profile_url: 'https://example.com/1' },
  { id: 'db-lead-2', profile_url: 'https://example.com/2' }
];

function createWriter(
  leadError: unknown | null = null,
  linkError: unknown | null = null
): LeadPersistenceWriter {
  return {
    async upsertLeads() {
      return { data: persistedLeads, error: leadError };
    },
    async upsertClientLinks(leads) {
      assert.deepEqual(leads, persistedLeads);
      return {
        confirmedCount: linkError ? 0 : leads.length,
        error: linkError
      };
    }
  };
}

test('local storage additions are explicitly reported as local-only without Supabase', async () => {
  const result = await persistLeadsAndLinks(localResult, 2);

  assert.equal(result.added, 2);
  assert.equal(result.duplicatesSkipped, 1);
  assert.equal(result.persistenceStatus, 'local_only');
  assert.match(result.persistenceMessage, /only; Supabase is not configured/);
});

test('reports Supabase lead upsert failure without claiming database persistence', async () => {
  const result = await persistLeadsAndLinks(
    localResult,
    2,
    createWriter({ message: 'database rejected write' })
  );

  assert.equal(result.persistenceStatus, 'local_only');
  assert.match(result.persistenceMessage, /Supabase did not confirm lead persistence/);
});

test('reports client-link upsert failure as partial database persistence', async () => {
  const result = await persistLeadsAndLinks(
    localResult,
    2,
    createWriter(null, { message: 'link write rejected' })
  );

  assert.equal(result.persistenceStatus, 'partial');
  assert.match(result.persistenceMessage, /did not confirm all client links/);
});

test('confirms persistence only after both Supabase upserts succeed', async () => {
  const result = await persistLeadsAndLinks(localResult, 2, createWriter());

  assert.equal(result.persistenceStatus, 'confirmed');
  assert.match(result.persistenceMessage, /confirmed lead persistence and client links/);
});

test('does not claim persistence when Supabase returns fewer lead rows than requested', async () => {
  const writer = createWriter();
  writer.upsertLeads = async () => ({ data: persistedLeads.slice(0, 1), error: null });
  writer.upsertClientLinks = async () => ({ confirmedCount: 1, error: null });

  const result = await persistLeadsAndLinks(localResult, 2, writer);

  assert.equal(result.persistenceStatus, 'partial');
  assert.match(result.persistenceMessage, /only some lead records/);
});

test('does not confirm persistence unless every client link is visible in the workspace', async () => {
  const writer = createWriter();
  writer.upsertClientLinks = async () => ({ confirmedCount: 1, error: null });

  const result = await persistLeadsAndLinks(localResult, 2, writer);

  assert.equal(result.persistenceStatus, 'partial');
  assert.match(result.persistenceMessage, /did not confirm all client links/);
});

test('skips database claims when there are no new leads', async () => {
  const result = await persistLeadsAndLinks({ added: 0, duplicatesSkipped: 2 }, 0, createWriter());

  assert.equal(result.persistenceStatus, 'not_needed');
});
