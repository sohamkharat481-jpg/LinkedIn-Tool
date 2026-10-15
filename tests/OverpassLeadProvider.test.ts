import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAndDeduplicateLeads, isValidLeadRecord } from '../src/services/deduplication';
import {
  buildOverpassQuery,
  mapOsmElementToLead,
  OverpassApiError,
  OverpassLeadProvider
} from '../src/services/leadProviders/OverpassLeadProvider';
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
  delays: number[] = []
): OverpassLeadProvider =>
  new OverpassLeadProvider(
    'https://overpass-api.de/api/interpreter',
    fetcher,
    async () => {},
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
  const provider = createTestProvider(async () => {
    calls++;
    if (calls === 1) return new Response('upstream error', { status: 502 });
    return new Response(JSON.stringify({ elements: [cafeElement] }), { status: 200 });
  }, delays);

  const leads = await provider.search({ ...filters, city: '502 retry test' });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [500]);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].companyName, 'Example Cafe');
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
    assert.match(error.message, /timed out \(15s limit\)/);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test('keeps the timeout active while reading the response body', async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = createTestProvider(async () => {
    calls++;
    const response = new Response('{}', { status: 200 });
    response.json = async () => {
      const error = new Error('aborted while reading body');
      error.name = 'AbortError';
      throw error;
    };
    return response;
  }, delays);

  await assert.rejects(provider.search({ ...filters, city: 'body timeout test' }), (error: unknown) => {
    assert.ok(error instanceof OverpassApiError);
    assert.match(error.message, /timed out \(15s limit\)/);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1000]);
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
