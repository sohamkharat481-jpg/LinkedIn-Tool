import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAndDeduplicateLeads, isValidLeadRecord } from '../src/services/deduplication';
import {
  buildOverpassHealthCheckQuery,
  buildOverpassQuery,
  mapOsmElementToLead,
  OverpassApiError,
  OVERPASS_DEFAULT_TOTAL_BUDGET_MS,
  OverpassLeadProvider,
  OVERPASS_REQUEST_TIMEOUT_MS,
  OverpassRequestDiagnostics,
  OverpassSearchOptions
} from '../src/services/leadProviders/OverpassLeadProvider';
import { ServerLeadProviderService } from '../src/server/leadProviderService';
import { LeadFilter } from '../src/types';

const filters: LeadFilter = {
  jobTitles: [],
  industry: [],
  country: 'United Kingdom',
  city: 'London',
  seniority: [],
  companySize: [],
  maxLeads: 20
};

const cafeElement = {
  type: 'node' as const,
  id: 123,
  lat: 51.5,
  lon: -0.12,
  tags: {
    name: 'Example Cafe',
    amenity: 'cafe',
    'addr:street': 'High Street',
    'addr:housenumber': '10',
    'addr:city': 'London',
    'addr:country': 'GB',
    website: 'https://example.org',
    phone: '+44 20 0000 0000'
  }
};

const createTestProvider = (
  fetcher: typeof fetch,
  delays: number[] = [],
  waitForSlot: () => Promise<void> = async () => {}
): OverpassLeadProvider =>
  new OverpassLeadProvider(
    'https://overpass-api.de/api/interpreter',
    fetcher,
    waitForSlot,
    async milliseconds => {
      delays.push(milliseconds);
    }
  );

test('builds bounded city/country queries with capped output', () => {
  assert.throws(() => buildOverpassQuery({ ...filters, city: '' }), /requires both a city and country/);
  const query = buildOverpassQuery({ ...filters, city: 'London"]->.x; out;' }, 10000);
  assert.match(query, /\["admin_level"="2"\]/);
  assert.match(query, /\["admin_level"~"\^\(6\|7\|8\|9\|10\)\$"\]/);
  assert.match(query, /\[timeout:12\]/);
  assert.match(query, /out tags center 500;/);
  assert.ok(!query.includes('London"]->.x; out;'));
});

test('builds a tiny read-only health query around a bounded central London point', () => {
  const query = buildOverpassHealthCheckQuery();
  assert.match(query, /^\[out:json\]\[timeout:6\];/);
  assert.match(query, /nwr\(around:100,51\.5152,-0\.1419\)\["name"\]\["shop"\]/);
  assert.match(query, /out tags center 1;/);
  assert.ok(!query.includes('area['));
  assert.ok(!query.includes('map_to_area'));
  assert.ok(!query.includes('out body'));
});

test('uses the tiny health query only when health-check mode is requested', async () => {
  let requestBody = '';
  const provider = createTestProvider(async (_input, init) => {
    if (typeof init?.body === 'string') requestBody = init.body;
    return new Response(JSON.stringify({ elements: [cafeElement] }), { status: 200 });
  });

  await provider.search(filters, { healthCheck: true, maxResults: 1 });
  const query = new URLSearchParams(requestBody).get('data') || '';
  assert.match(query, /around:100,51\.5152,-0\.1419/);
  assert.ok(!query.includes('area['));
});

test('maps only present business fields and retains OSM identity', () => {
  const lead = mapOsmElementToLead(cafeElement);
  assert.ok(lead);
  assert.equal(lead.companyName, 'Example Cafe');
  assert.equal(lead.businessCategory, 'amenity: cafe');
  assert.equal(lead.businessAddress, '10 High Street, London, GB');
  assert.equal(lead.businessWebsite, 'https://example.org');
  assert.equal(lead.businessPhone, '+44 20 0000 0000');
  assert.deepEqual([lead.latitude, lead.longitude], [51.5, -0.12]);
  assert.equal(lead.osmId, 123);

  const sparseLead = mapOsmElementToLead({
    type: 'way',
    id: 124,
    center: { lat: 51.51, lon: -0.11 },
    tags: { name: 'Unnamed Contact Cafe', amenity: 'cafe' }
  });
  assert.ok(sparseLead);
  assert.equal(sparseLead.businessWebsite, '');
  assert.equal(sparseLead.businessPhone, '');
  assert.equal(sparseLead.businessAddress, '');
  assert.equal(sparseLead.businessCity, '');
  assert.equal(sparseLead.businessCountry, '');
  assert.deepEqual([sparseLead.latitude, sparseLead.longitude], [51.51, -0.11]);
  assert.equal(mapOsmElementToLead({ type: 'node', id: 1, tags: { amenity: 'cafe' } }), null);
});

test('validates and deduplicates business records by OSM id and named address', () => {
  const first = mapOsmElementToLead(cafeElement);
  const sameOsmId = mapOsmElementToLead({ ...cafeElement });
  const sameAddress = mapOsmElementToLead({
    ...cafeElement,
    type: 'way',
    id: 456
  });
  assert.ok(first && sameOsmId && sameAddress);
  assert.equal(isValidLeadRecord(first), true);

  const result = filterAndDeduplicateLeads([first, sameOsmId, sameAddress]);
  assert.equal(result.validRecordsCount, 3);
  assert.equal(result.duplicateBusinessesRemoved, 2);
  assert.equal(result.finalUniqueLeads.length, 1);
  assert.equal(
    isValidLeadRecord({ ...first, profileUrl: 'https://www.openstreetmap.org/node/999' }),
    false
  );
});

test('surfaces Overpass HTTP 429 without pretending the search succeeded', async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = createTestProvider(async (_input, init) => {
    calls++;
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('User-Agent')?.startsWith('LinkedInLeadFinder/'), true);
    return new Response('rate limited', { status: 429 });
  }, delays);

  await assert.rejects(provider.search(filters), (error: unknown) => {
    assert.ok(error instanceof OverpassApiError);
    assert.equal(error.httpStatus, 429);
    assert.match(error.message, /rate-limiting/);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test('retries HTTP 502 with bounded exponential backoff and accepts a successful response', async () => {
  let calls = 0;
  const delays: number[] = [];
  let completedDiagnostics: OverpassRequestDiagnostics | undefined;
  const provider = createTestProvider(async () => {
    calls++;
    if (calls === 1) return new Response('upstream error', { status: 502 });
    return new Response(JSON.stringify({ elements: [cafeElement] }), { status: 200 });
  }, delays);

  const leads = await provider.search({ ...filters, city: '502 retry test' }, {
    onDiagnostics: diagnostics => {
      completedDiagnostics = diagnostics;
    }
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [500]);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].companyName, 'Example Cafe');
  assert.equal(completedDiagnostics?.httpStatus, 200);
  assert.equal(typeof completedDiagnostics?.requestStartedAt, 'string');
  assert.equal(typeof completedDiagnostics?.responseHeadersElapsedMs, 'number');
  assert.equal(typeof completedDiagnostics?.responseBodyCompletedElapsedMs, 'number');
  assert.equal(typeof completedDiagnostics?.jsonParsingCompletedElapsedMs, 'number');
});

test('preserves upstream HTTP 500, 502, and 504 with attempt and elapsed diagnostics', async () => {
  for (const status of [500, 502, 504]) {
    const provider = createTestProvider(async () => new Response('upstream failure', { status }));
    await assert.rejects(
      provider.search({ ...filters, city: `upstream ${status} test` }, { maxAttempts: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof OverpassApiError);
        assert.equal(error.httpStatus, status);
        assert.equal(error.diagnostics.upstreamHttpStatus, status);
        assert.equal(error.diagnostics.httpStatus, status);
        assert.equal(error.diagnostics.failurePhase, 'http_status');
        assert.equal(error.diagnostics.failureOrigin, 'http_response');
        assert.equal(error.diagnostics.responseHeadersReceived, true);
        assert.equal(typeof error.diagnostics.responseHeadersElapsedMs, 'number');
        assert.equal(error.diagnostics.responseBodyCompletedElapsedMs, undefined);
        assert.equal(error.diagnostics.attemptCount, 1);
        assert.ok(typeof error.diagnostics.elapsedMs === 'number');
        return true;
      }
    );
  }
});

test('honors Retry-After when retrying HTTP 503', async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = createTestProvider(async () => {
    calls++;
    if (calls === 1) {
      return new Response('temporarily unavailable', {
        status: 503,
        headers: { 'Retry-After': '3' }
      });
    }
    return new Response(JSON.stringify({ elements: [] }), { status: 200 });
  }, delays);

  const leads = await provider.search({ ...filters, city: 'retry after test' });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [3000]);
  assert.deepEqual(leads, []);
});

test('does not retry before an excessive Retry-After value', async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = createTestProvider(async () => {
    calls++;
    return new Response('temporarily unavailable', {
      status: 503,
      headers: { 'Retry-After': '60' }
    });
  }, delays);

  await assert.rejects(provider.search({ ...filters, city: 'long retry after test' }), (error: unknown) => {
    assert.ok(error instanceof OverpassApiError);
    assert.equal(error.httpStatus, 503);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test('bounds retries for request timeouts', async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = createTestProvider(async () => {
    calls++;
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  }, delays);

  await assert.rejects(provider.search({ ...filters, city: 'timeout retry test' }), (error: unknown) => {
    assert.ok(error instanceof OverpassApiError);
    assert.match(error.message, /timed out \(5s per-attempt limit\)/);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test('aborts a stalled request when its total time budget expires', async () => {
  let requestSignal: AbortSignal | undefined;
  const provider = createTestProvider((_input, init) => {
    requestSignal = init?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });

  await assert.rejects(
    provider.search({ ...filters, city: 'total timeout test' }, { totalBudgetMs: 30, maxAttempts: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.match(error.message, /Total request budget exceeded \(30ms\)/);
      assert.equal(error.diagnostics.attemptCount, 1);
      assert.equal(error.diagnostics.timeoutReason, 'Total request budget exceeded (30ms).');
      assert.equal(error.diagnostics.failurePhase, 'request');
      assert.equal(error.diagnostics.timeoutFired, true);
      assert.equal(error.diagnostics.failureOrigin, 'application_deadline');
      assert.equal(error.diagnostics.responseHeadersReceived, false);
      assert.equal(typeof error.diagnostics.requestStartedAt, 'string');
      assert.equal(error.diagnostics.responseHeadersElapsedMs, undefined);
      assert.ok((error.diagnostics.elapsedMs ?? 0) < 500);
      return true;
    }
  );
  assert.equal(requestSignal?.aborted, true);
});

test('captures sanitized native fetch and nested cause codes without logging messages', async () => {
  const cause = Object.assign(new Error('private nested detail'), { code: 'EAI_AGAIN' });
  const networkError = Object.assign(new Error('private token=never-log'), {
    code: 'ENOTFOUND',
    cause
  });
  const provider = createTestProvider(async () => {
    throw networkError;
  });

  await assert.rejects(
    provider.search({ ...filters, city: 'native fetch rejection diagnostics' }, {
      maxAttempts: 1,
      totalBudgetMs: 500,
      diagnosticContext: { requestId: 'bom1::request-123' }
    }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.equal(error.diagnostics.errorName, 'Error');
      assert.equal(error.diagnostics.errorCode, 'ENOTFOUND');
      assert.equal(error.diagnostics.causeCode, 'EAI_AGAIN');
      assert.equal(error.diagnostics.failureOrigin, 'fetch_rejection');
      assert.equal(error.diagnostics.timeoutFired, false);
      assert.equal(error.diagnostics.responseHeadersReceived, false);
      assert.equal(error.diagnostics.httpStatus, undefined);
      assert.equal(error.diagnostics.upstreamHostname, 'overpass-api.de');
      assert.equal(error.diagnostics.requestId, 'bom1::request-123');
      assert.ok(!JSON.stringify(error.diagnostics).includes('private'));
      assert.ok(!JSON.stringify(error.diagnostics).includes('never-log'));
      return true;
    }
  );
});

test('records response-header and body timings on a successful request', async () => {
  let diagnostics: OverpassRequestDiagnostics | undefined;
  const provider = createTestProvider(async () =>
    new Response(JSON.stringify({ elements: [cafeElement] }), { status: 200 })
  );

  const leads = await provider.search({ ...filters, city: 'successful timing diagnostics' }, {
    maxAttempts: 1,
    totalBudgetMs: 500,
    onDiagnostics: result => {
      diagnostics = result;
    }
  });

  assert.equal(leads.length, 1);
  assert.equal(diagnostics?.providerId, 'openstreetmap-overpass-provider');
  assert.equal(diagnostics?.upstreamHostname, 'overpass-api.de');
  assert.equal(diagnostics?.responseHeadersReceived, true);
  assert.equal(diagnostics?.httpStatus, 200);
  assert.equal(typeof diagnostics?.responseHeadersElapsedMs, 'number');
  assert.equal(typeof diagnostics?.responseBodyCompletedElapsedMs, 'number');
  assert.equal(typeof diagnostics?.elapsedMs, 'number');
  assert.equal(diagnostics?.timeoutFired, false);
});

test('enforces the total budget while waiting for an interval slot', async () => {
  let requests = 0;
  const provider = createTestProvider(async () => {
    requests++;
    return new Response(JSON.stringify({ elements: [] }), { status: 200 });
  }, [], () => new Promise(() => {}));

  await assert.rejects(
    provider.search({ ...filters, city: 'slot budget test' }, { totalBudgetMs: 25 }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.equal(error.diagnostics.timeoutReason, 'Total request time budget exceeded.');
      assert.equal(error.diagnostics.attemptCount, 0);
      assert.equal(error.diagnostics.timeoutFired, true);
      assert.equal(error.diagnostics.failureOrigin, 'application_deadline');
      return true;
    }
  );
  assert.equal(requests, 0);
});

test('enforces the total budget instead of sleeping past Retry-After', async () => {
  let calls = 0;
  const provider = new OverpassLeadProvider(
    'https://overpass-api.de/api/interpreter',
    async () => {
      calls++;
      return new Response('busy', { status: 503, headers: { 'Retry-After': '1' } });
    },
    async () => {},
    milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  );

  await assert.rejects(
    provider.search({ ...filters, city: 'retry-after budget test' }, { totalBudgetMs: 35 }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.equal(error.diagnostics.upstreamHttpStatus, 503);
      assert.equal(error.diagnostics.attemptCount, 1);
      assert.match(error.diagnostics.timeoutReason || '', /budget exceeded/);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test('keeps a response-body read inside the request timeout and retries it safely', async () => {
  let calls = 0;
  let lastSignal: AbortSignal | undefined;
  const delays: number[] = [];
  const provider = createTestProvider((_input, init) => {
    calls++;
    lastSignal = init?.signal as AbortSignal;
    const response = new Response('');
    response.text = () => new Promise<string>(() => {});
    return Promise.resolve(response);
  }, delays);

  await assert.rejects(
    provider.search({ ...filters, city: 'body timeout test' }, { totalBudgetMs: 25, maxAttempts: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.match(error.message, /Total request budget exceeded \(25ms\)/);
      assert.equal(error.diagnostics.failurePhase, 'response_body');
      assert.equal(error.diagnostics.httpStatus, 200);
      assert.equal(typeof error.diagnostics.responseHeadersElapsedMs, 'number');
      assert.equal(error.diagnostics.responseBodyCompletedElapsedMs, undefined);
      return true;
    }
  );
  assert.equal(calls, 1);
  assert.equal(lastSignal?.aborted, true);
});

test('records body-read failures separately from response-header failures', async () => {
  const provider = createTestProvider(async () => {
    const response = new Response('');
    response.text = async () => {
      throw new Error('body read failed');
    };
    return response;
  });

  await assert.rejects(
    provider.search({ ...filters, city: 'body phase failure test' }, { maxAttempts: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.equal(error.diagnostics.failurePhase, 'response_body');
      assert.equal(error.diagnostics.httpStatus, 200);
      assert.equal(typeof error.diagnostics.responseHeadersElapsedMs, 'number');
      assert.equal(error.diagnostics.responseBodyCompletedElapsedMs, undefined);
      return true;
    }
  );
});

test('records JSON parsing failures after the response body completes', async () => {
  const provider = createTestProvider(async () => new Response('{not json', { status: 200 }));

  await assert.rejects(
    provider.search({ ...filters, city: 'json parse phase failure test' }, { maxAttempts: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.equal(error.diagnostics.failurePhase, 'json_parse');
      assert.equal(error.diagnostics.httpStatus, 200);
      assert.equal(typeof error.diagnostics.responseHeadersElapsedMs, 'number');
      assert.equal(typeof error.diagnostics.responseBodyCompletedElapsedMs, 'number');
      assert.equal(typeof error.diagnostics.jsonParsingCompletedElapsedMs, 'number');
      return true;
    }
  );
});

test('returns a genuine empty result without retries', async () => {
  let calls = 0;
  const provider = createTestProvider(async () => {
    calls++;
    return new Response(JSON.stringify({ elements: [] }), { status: 200 });
  });

  const leads = await provider.search({ ...filters, city: 'empty result test' });
  assert.deepEqual(leads, []);
  assert.equal(calls, 1);
});

test('uses a runtime-bounded default budget and returns a structured overall deadline error', async () => {
  assert.equal(OVERPASS_DEFAULT_TOTAL_BUDGET_MS, 6000);
  assert.ok(OVERPASS_DEFAULT_TOTAL_BUDGET_MS < 8000);
  assert.equal(OVERPASS_REQUEST_TIMEOUT_MS, 5000);

  const provider = createTestProvider((_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true }
      );
    })
  );
  const startedAt = Date.now();

  await assert.rejects(
    provider.search(filters, { totalBudgetMs: 80, maxAttempts: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.match(error.message, /Total request budget exceeded \(80ms\)/);
      assert.equal(error.diagnostics.timeoutFired, true);
      assert.equal(error.diagnostics.failureOrigin, 'application_deadline');
      assert.equal(error.diagnostics.failurePhase, 'request');
      return true;
    }
  );
  assert.ok(Date.now() - startedAt < 1000);
});

test('enforces the shorter per-request timeout before the overall search deadline', async () => {
  const provider = createTestProvider((_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true }
      );
    })
  );

  await assert.rejects(
    provider.search(filters, {
      totalBudgetMs: OVERPASS_REQUEST_TIMEOUT_MS + 1000,
      maxAttempts: 1
    }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.match(error.message, /Overpass request timed out \(5s per-attempt limit\)/);
      assert.equal(error.diagnostics.timeoutFired, true);
      assert.equal(error.diagnostics.failureOrigin, 'application_deadline');
      return true;
    }
  );
});

test('bypasses cached data when performing an explicitly fresh check', async () => {
  let calls = 0;
  const provider = createTestProvider(async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ elements: [cafeElement] }), { status: 200 });
    return new Response('temporarily unavailable', { status: 502 });
  });
  const checkFilters = { ...filters, city: 'fresh health-check cache test' };

  assert.equal((await provider.search(checkFilters, { maxResults: 1 })).length, 1);
  await assert.rejects(
    provider.search(checkFilters, { bypassCache: true, maxResults: 1, maxAttempts: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof OverpassApiError);
      assert.equal(error.httpStatus, 502);
      return true;
    }
  );
  assert.equal(calls, 2);
});

test('health checks use a configurable single-request budget and do not pass on empty data', async () => {
  const searchDescriptor = Object.getOwnPropertyDescriptor(OverpassLeadProvider.prototype, 'search');
  const originalBudget = process.env.OVERPASS_HEALTH_CHECK_BUDGET_MS;
  let searchOptions: OverpassSearchOptions | undefined;

  Object.defineProperty(OverpassLeadProvider.prototype, 'search', {
    configurable: true,
    value: async (_filters: LeadFilter, options: OverpassSearchOptions) => {
      searchOptions = options;
      options.onDiagnostics?.({
        attemptCount: 1,
        elapsedMs: 30,
        requestStartedAt: '2026-10-16T00:00:00.000Z',
        responseHeadersElapsedMs: 15,
        httpStatus: 200,
        responseBodyCompletedElapsedMs: 25,
        jsonParsingCompletedElapsedMs: 1
      });
      return [];
    }
  });
  process.env.OVERPASS_HEALTH_CHECK_BUDGET_MS = '12000';

  try {
    const result = await ServerLeadProviderService.testConnection(undefined, 'overpass');
    assert.equal(searchOptions?.bypassCache, true);
    assert.equal(searchOptions?.healthCheck, true);
    assert.equal(searchOptions?.maxResults, 1);
    assert.equal(searchOptions?.maxAttempts, 1);
    assert.equal(searchOptions?.totalBudgetMs, 12000);
    assert.equal(result.success, false);
    assert.equal(result.httpStatus, 503);
    assert.equal(result.upstreamHttpStatus, 200);
    assert.equal(result.placesReturned, 0);
    assert.match(result.message, /no named business data/);
    assert.equal(result.diagnostics?.httpStatus, 200);
    assert.equal(typeof result.diagnostics?.responseBodyCompletedElapsedMs, 'number');
    assert.equal(typeof result.diagnostics?.jsonParsingCompletedElapsedMs, 'number');
    assert.equal(ServerLeadProviderService.getStatus(undefined, 'overpass').status, 'Error');
  } finally {
    if (searchDescriptor) {
      Object.defineProperty(OverpassLeadProvider.prototype, 'search', searchDescriptor);
    } else {
      delete (OverpassLeadProvider.prototype as { search?: unknown }).search;
    }
    if (originalBudget === undefined) delete process.env.OVERPASS_HEALTH_CHECK_BUDGET_MS;
    else process.env.OVERPASS_HEALTH_CHECK_BUDGET_MS = originalBudget;
  }
});

test('health diagnostics preserve sanitized upstream status, attempts, elapsed time and timeout reason', async () => {
  const searchDescriptor = Object.getOwnPropertyDescriptor(OverpassLeadProvider.prototype, 'search');
  const originalConsoleWarn = console.warn;
  let diagnosticContext: { requestId?: string } | undefined;
  Object.defineProperty(OverpassLeadProvider.prototype, 'search', {
    configurable: true,
    value: async (_filters: LeadFilter, options: OverpassSearchOptions) => {
      diagnosticContext = options.diagnosticContext;
      throw new OverpassApiError(
        'OpenStreetMap Overpass is temporarily unavailable (HTTP 502). Try again later.',
        502,
        {
          attemptCount: 2,
          elapsedMs: 734,
          upstreamHttpStatus: 502,
          timeoutReason: 'Retry budget would exceed the health-check deadline.',
          requestStartedAt: '2026-10-16T00:00:00.000Z',
          requestStartedElapsedMs: 0,
          responseHeadersElapsedMs: 733,
          httpStatus: 502,
          failurePhase: 'http_status',
          providerId: 'openstreetmap-overpass-provider',
          upstreamHostname: 'overpass-api.de',
          requestId: 'bom1::overpass-diag',
          deploymentSha: 'abcdef1234567',
          responseHeadersReceived: true,
          timeoutFired: false,
          failureOrigin: 'http_response',
          errorName: 'TypeError',
          errorCode: 'ECONNRESET',
          causeCode: 'ETIMEDOUT'
        }
      );
    }
  });

  try {
    console.warn = () => {};
    const result = await ServerLeadProviderService.testConnection(undefined, 'overpass', {
      requestId: 'bom1::overpass-diag'
    });
    assert.equal(diagnosticContext?.requestId, 'bom1::overpass-diag');
    assert.equal(result.success, false);
    assert.equal(result.httpStatus, 502);
    assert.equal(result.upstreamHttpStatus, 502);
    assert.equal(result.attemptCount, 2);
    assert.equal(result.elapsedMs, 734);
    assert.equal(result.timeoutReason, 'Retry budget would exceed the health-check deadline.');
    assert.equal(result.diagnostics?.attemptCount, 2);
    assert.equal(result.diagnostics?.elapsedMs, 734);
    assert.equal(result.diagnostics?.upstreamHttpStatus, 502);
    assert.equal(result.diagnostics?.timeoutReason, 'Retry budget would exceed the health-check deadline.');
    assert.equal(result.diagnostics?.failurePhase, 'http_status');
    assert.equal(result.diagnostics?.httpStatus, 502);
    assert.equal(typeof result.diagnostics?.responseHeadersElapsedMs, 'number');
    assert.equal(result.diagnostics?.providerId, 'openstreetmap-overpass-provider');
    assert.equal(result.diagnostics?.upstreamHostname, 'overpass-api.de');
    assert.equal(result.diagnostics?.requestId, 'bom1::overpass-diag');
    assert.equal(result.diagnostics?.deploymentSha, 'abcdef1234567');
    assert.equal(result.diagnostics?.responseHeadersReceived, true);
    assert.equal(result.diagnostics?.timeoutFired, false);
    assert.equal(result.diagnostics?.failureOrigin, 'http_response');
    assert.equal(result.diagnostics?.errorName, 'TypeError');
    assert.equal(result.diagnostics?.errorCode, 'ECONNRESET');
    assert.equal(result.diagnostics?.causeCode, 'ETIMEDOUT');
    const status = ServerLeadProviderService.getStatus(undefined, 'overpass');
    assert.equal(status.diagnostics?.upstreamHttpStatus, 502);
    assert.equal(status.diagnostics?.attemptCount, 2);
  } finally {
    console.warn = originalConsoleWarn;
    if (searchDescriptor) {
      Object.defineProperty(OverpassLeadProvider.prototype, 'search', searchDescriptor);
    } else {
      delete (OverpassLeadProvider.prototype as { search?: unknown }).search;
    }
  }
});
