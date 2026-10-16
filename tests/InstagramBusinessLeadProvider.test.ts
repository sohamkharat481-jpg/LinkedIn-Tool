import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAndDeduplicateLeads, isValidLeadRecord } from '../src/services/deduplication';
import {
  InstagramBusinessLeadProvider,
  InstagramBusinessProviderError
} from '../src/services/leadProviders/InstagramBusinessLeadProvider';
import { dbService } from '../src/services/storage';
import { LeadFilter } from '../src/types';

const originalFetch = globalThis.fetch;
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalTimeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
const originalApiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiVersion === undefined) {
    delete process.env.INSTAGRAM_GRAPH_API_VERSION;
  } else {
    process.env.INSTAGRAM_GRAPH_API_VERSION = originalApiVersion;
  }
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
  if (originalTimeoutDescriptor) {
    Object.defineProperty(AbortSignal, 'timeout', originalTimeoutDescriptor);
  }
});

const filters: LeadFilter = {
  jobTitles: [],
  industry: ['Coffee'],
  country: 'India',
  city: 'Mumbai',
  seniority: [],
  companySize: [],
  maxLeads: 10,
  instagramUsernames: ['@bluebottle']
};

function mockFetch(response: Response | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    typeof response === 'function' ? response(input, init) : response) as typeof fetch;
}

test('queries the configured Business Discovery endpoint and maps only returned profile data', async () => {
  process.env.INSTAGRAM_GRAPH_API_VERSION = 'v25.0';
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  mockFetch((input, init) => {
    requestedUrl = new URL(input.toString());
    requestedInit = init;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          business_discovery: {
            username: 'bluebottle',
            name: 'Blue Bottle Coffee',
            biography: 'Coffee company',
            website: 'https://bluebottlecoffee.com',
            followers_count: 1234
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
  });

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  const leads = await provider.search(filters);

  assert.equal(requestedUrl?.origin, 'https://graph.facebook.com');
  assert.equal(requestedUrl?.pathname, '/v25.0/123456789');
  assert.match(
    requestedUrl?.searchParams.get('fields') || '',
    /^business_discovery\.username\(bluebottle\)\{username,name,biography,website,followers_count\}$/
  );
  assert.equal(requestedUrl?.searchParams.has('access_token'), false);
  assert.equal(requestedUrl?.href.includes('private-test-token'), false);
  assert.equal(requestedInit?.method, 'GET');
  assert.equal(
    (requestedInit?.headers as Record<string, string>).Authorization,
    'Bearer private-test-token'
  );
  assert.deepEqual(leads, [
    {
      fullName: 'Blue Bottle Coffee',
      headline: 'Coffee company',
      currentJobTitle: '',
      companyName: 'Blue Bottle Coffee',
      location: '',
      profileUrl: 'https://www.instagram.com/bluebottle/',
      connectionsOrFollowers: '1234',
      lastActivityDate: 'N/A',
      source: 'Instagram Graph API Business Discovery',
      leadType: 'business',
      businessWebsite: 'https://bluebottlecoffee.com/'
    }
  ]);
});

test('verifies the configured Instagram professional account with a bounded GET health check', async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  mockFetch((input, init) => {
    requestedUrl = new URL(input.toString());
    requestedInit = init;
    return Promise.resolve(
      new Response(JSON.stringify({ id: '123456789', username: 'my_business' }), {
        status: 200
      })
    );
  });

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  await provider.testConnection();

  assert.equal(requestedUrl?.pathname, '/v25.0/123456789');
  assert.equal(requestedUrl?.searchParams.get('fields'), 'id,username');
  assert.equal(requestedInit?.method, 'GET');
});

test('does not fabricate leads when no Business Discovery record is returned', async () => {
  mockFetch(new Response(JSON.stringify({ id: '123456789' }), { status: 200 }));

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  assert.deepEqual(await provider.search(filters), []);
});

test('omits malformed optional contact URLs and still uses the returned public username', async () => {
  mockFetch(
    new Response(
      JSON.stringify({
        business_discovery: {
          username: 'bluebottle',
          website: 'javascript:alert(1)'
        }
      }),
      { status: 200 }
    )
  );

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  const [lead] = await provider.search(filters);

  assert.ok(lead);
  assert.equal(lead.fullName, 'bluebottle');
  assert.equal(lead.companyName, 'bluebottle');
  assert.equal(lead.businessWebsite, undefined);
  assert.equal(lead.location, '');
});

test('rejects a mismatched username returned by Meta instead of creating a different lead', async () => {
  mockFetch(
    new Response(
      JSON.stringify({
        business_discovery: { username: 'different_account', name: 'Different Account' }
      }),
      { status: 200 }
    )
  );

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  assert.deepEqual(await provider.search(filters), []);
});

test('rejects invalid handles before making an upstream request', async () => {
  let requested = false;
  mockFetch(async () => {
    requested = true;
    return new Response('{}', { status: 200 });
  });

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  await assert.rejects(
    provider.search({ ...filters, instagramUsernames: ['not a valid handle'] }),
    (error: unknown) =>
      error instanceof InstagramBusinessProviderError &&
      error.httpStatus === 400
  );
  assert.equal(requested, false);
});

test('rejects non-text handles and more than the bounded username count', async () => {
  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');

  await assert.rejects(
    provider.search({ ...filters, instagramUsernames: [42 as never] }),
    (error: unknown) =>
      error instanceof InstagramBusinessProviderError &&
      error.httpStatus === 400
  );
  await assert.rejects(
    provider.search({
      ...filters,
      instagramUsernames: Array.from({ length: 21 }, (_, index) => `business_${index}`)
    }),
    (error: unknown) =>
      error instanceof InstagramBusinessProviderError &&
      error.httpStatus === 400 &&
      error.message.includes('at most 20')
  );
});

test('reports sanitized authentication and permission errors', async () => {
  mockFetch(
    new Response(
      JSON.stringify({
        error: { code: 190, message: 'private-test-token must not be returned to the caller' }
      }),
      { status: 403 }
    )
  );

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  await assert.rejects(
    provider.search(filters),
    (error: unknown) =>
      error instanceof InstagramBusinessProviderError &&
      error.httpStatus === 403 &&
      !error.message.includes('private-test-token') &&
      !error.message.includes('must not be returned')
  );
});

test('reports rate limiting without exposing the upstream response body', async () => {
  mockFetch(
    new Response(JSON.stringify({ error: { code: 17, message: 'private details' } }), {
      status: 429
    })
  );

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  await assert.rejects(
    provider.search(filters),
    (error: unknown) =>
      error instanceof InstagramBusinessProviderError &&
      error.httpStatus === 429 &&
      !error.message.includes('private details')
  );
});

test('reports network failures with a sanitized message', async () => {
  mockFetch(async () => {
    throw new TypeError('private-test-token connection details');
  });

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  await assert.rejects(
    provider.search(filters),
    (error: unknown) =>
      error instanceof InstagramBusinessProviderError &&
      error.httpStatus === 502 &&
      !error.message.includes('private-test-token')
  );
});

test('reports malformed JSON as an upstream response error', async () => {
  mockFetch(new Response('{ invalid', { status: 200 }));

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  await assert.rejects(
    provider.search(filters),
    (error: unknown) =>
      error instanceof InstagramBusinessProviderError &&
      error.httpStatus === 502 &&
      error.message.includes('invalid response')
  );
});

test('reports overall request-deadline expiry without returning partial results', async () => {
  Object.defineProperty(AbortSignal, 'timeout', {
    configurable: true,
    value: () => {
      const controller = new AbortController();
      controller.abort();
      return controller.signal;
    }
  });
  mockFetch(async () => {
    throw new DOMException('aborted', 'AbortError');
  });

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  await assert.rejects(
    provider.search(filters),
    (error: unknown) =>
      error instanceof InstagramBusinessProviderError &&
      error.httpStatus === 504 &&
      error.message.includes('overall request time budget')
  );
});

test('reports per-lookup timeout without exposing the native abort error', async () => {
  let timeoutCalls = 0;
  Object.defineProperty(AbortSignal, 'timeout', {
    configurable: true,
    value: () => {
      timeoutCalls += 1;
      if (timeoutCalls === 1) return new AbortController().signal;
      const controller = new AbortController();
      controller.abort();
      return controller.signal;
    }
  });
  mockFetch(async () => {
    throw new DOMException('aborted', 'AbortError');
  });

  const provider = new InstagramBusinessLeadProvider('private-test-token', '123456789');
  await assert.rejects(
    provider.search(filters),
    (error: unknown) =>
      error instanceof InstagramBusinessProviderError &&
      error.httpStatus === 504 &&
      error.message.includes('lookup timed out')
  );
});

test('validates and deduplicates Instagram business leads by canonical profile URL', () => {
  const baseLead = {
    fullName: 'Blue Bottle Coffee',
    headline: '',
    currentJobTitle: '',
    companyName: 'Blue Bottle Coffee',
    location: '',
    profileUrl: 'https://www.instagram.com/BlueBottle/?utm_source=example',
    source: 'Instagram Graph API Business Discovery',
    leadType: 'business' as const
  };

  assert.equal(isValidLeadRecord(baseLead), true);
  assert.equal(
    isValidLeadRecord({ ...baseLead, profileUrl: 'https://example.com/BlueBottle' }),
    false
  );

  const result = filterAndDeduplicateLeads([
    baseLead,
    { ...baseLead, profileUrl: 'https://instagram.com/bluebottle/' }
  ]);
  assert.equal(result.rawCandidatesCount, 2);
  assert.equal(result.validRecordsCount, 2);
  assert.equal(result.duplicateBusinessesRemoved, 1);
  assert.equal(result.finalUniqueLeads.length, 1);
  assert.equal(result.finalUniqueLeads[0].profileUrl, 'https://www.instagram.com/bluebottle/');
});

test('keeps saved Instagram leads isolated to the supplied workspace and client', () => {
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) || null,
      setItem: (key: string, value: string) => items.set(key, value)
    }
  });
  const lead = {
    id: 'instagram-lead-1',
    workspaceId: 'workspace-one',
    clientId: 'client-one',
    fullName: 'Blue Bottle Coffee',
    headline: 'Coffee company',
    currentJobTitle: '',
    companyName: 'Blue Bottle Coffee',
    location: '',
    profileUrl: 'https://www.instagram.com/bluebottle/',
    connectionsOrFollowers: '1234',
    lastActivityDate: 'N/A',
    dateAdded: '2026-01-01',
    status: 'Not Contacted' as const,
    notes: '',
    source: 'Instagram Graph API Business Discovery',
    leadType: 'business' as const
  };

  const saveResult = dbService.saveLeadsForClient('workspace-one', 'client-one', [lead]);

  assert.equal(saveResult.added, 1);
  assert.equal(dbService.getLeadsForClient('workspace-one', 'client-one').length, 1);
  assert.equal(dbService.getLeadsForClient('workspace-one', 'client-two').length, 0);
  assert.equal(dbService.getLeadsForClient('workspace-two', 'client-one').length, 0);
});
