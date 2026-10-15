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

test('builds bounded city/country queries with capped output', () => {
  assert.throws(() => buildOverpassQuery({ ...filters, city: '' }), /requires both a city and country/);
  const query = buildOverpassQuery({ ...filters, city: 'London"]->.x; out;' }, 10000);
  assert.match(query, /\["admin_level"="2"\]/);
  assert.match(query, /\["admin_level"~"\^\(6\|7\|8\|9\|10\)\$"\]/);
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
  const provider = new OverpassLeadProvider(
    'https://overpass-api.de/api/interpreter',
    async (_input, init) => {
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('User-Agent')?.startsWith('LinkedInLeadFinder/'), true);
      return new Response('rate limited', { status: 429 });
    }
  );

  await assert.rejects(provider.search(filters), (error: unknown) => {
    assert.ok(error instanceof OverpassApiError);
    assert.equal(error.httpStatus, 429);
    assert.match(error.message, /rate-limiting/);
    return true;
  });
});
