import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { filterAndDeduplicateLeads, isValidLeadRecord } from '../src/services/deduplication';
import {
  buildWikidataCafeQuery,
  mapWikidataBindingToLead,
  WikidataLeadProvider,
  WikidataProviderError
} from '../src/services/leadProviders/WikidataLeadProvider';
import { ServerLeadProviderService } from '../src/server/leadProviderService';
import { apiRouter } from '../src/server/apiHandler';
import { LeadFilter } from '../src/types';

const filters: LeadFilter = {
  jobTitles: [],
  industry: ['cafe'],
  country: 'India',
  city: 'Mumbai',
  seniority: [],
  companySize: [],
  maxLeads: 4
};

const cafeBinding = {
  business: { type: 'uri', value: 'http://www.wikidata.org/entity/Q22330084' },
  businessLabel: { 'xml:lang': 'en', type: 'literal', value: 'Cafe Mondegar' },
  coord: {
    datatype: 'http://www.opengis.net/ont/geosparql#wktLiteral',
    type: 'literal',
    value: 'Point(72.832126 18.924158)'
  },
  address: {
    'xml:lang': 'en',
    type: 'literal',
    value: 'Metro House, Colaba, Mumbai, Maharashtra, India'
  }
};

test('builds a bounded read-only city cafe query with escaped input and capped limit', () => {
  const query = buildWikidataCafeQuery(
    { ...filters, city: 'Mumbai"@en . ?x ?y ?z' },
    1000
  );
  assert.match(query, /SERVICE wikibase:around/);
  assert.match(query, /wikibase:radius "25"/);
  assert.match(query, /LIMIT 20$/);
  assert.ok(query.includes(`rdfs:label ${JSON.stringify('Mumbai"@en . ?x ?y ?z')}@en;`));
  assert.ok(query.includes('OPTIONAL { ?business wdt:P1329 ?phone. }'));
});

test('requires a bounded city/country and an explicitly supported cafe category', () => {
  assert.throws(
    () => buildWikidataCafeQuery({ ...filters, city: '' }),
    /requires both a city and country/
  );
  assert.throws(
    () => buildWikidataCafeQuery({ ...filters, industry: ['software'] }),
    /supports cafe searches only/
  );
  assert.throws(
    () => buildWikidataCafeQuery({ ...filters, industry: ['cafe', 'software'] }),
    /supports cafe searches only/
  );
});

test('reports unsupported search filters as client errors', async () => {
  const provider = new WikidataLeadProvider(undefined, async () => {
    throw new Error('An unsupported filter should not make a request.');
  });
  await assert.rejects(
    provider.search({ ...filters, industry: ['software'] }),
    (error: unknown) =>
      error instanceof WikidataProviderError &&
      error.httpStatus === 400 &&
      /supports cafe searches only/.test(error.message)
  );
});

test('maps genuine entity identifiers and only source-provided optional fields', () => {
  const lead = mapWikidataBindingToLead(cafeBinding);
  assert.ok(lead);
  assert.equal(lead.companyName, 'Cafe Mondegar');
  assert.equal(lead.source, 'Wikidata Query Service');
  assert.equal(lead.profileUrl, 'https://www.wikidata.org/entity/Q22330084');
  assert.equal(lead.businessCategory, 'cafe');
  assert.equal(lead.businessAddress, 'Metro House, Colaba, Mumbai, Maharashtra, India');
  assert.deepEqual([lead.latitude, lead.longitude], [18.924158, 72.832126]);
  assert.equal(lead.businessWebsite, '');
  assert.equal(lead.businessPhone, '');
  assert.equal(lead.businessCity, undefined);
  assert.equal(lead.businessCountry, undefined);
  assert.equal(isValidLeadRecord(lead), true);
});

test('rejects malformed or fabricated-looking entity bindings and coordinates', () => {
  assert.equal(mapWikidataBindingToLead(null), null);
  assert.equal(
    mapWikidataBindingToLead({
      ...cafeBinding,
      business: { type: 'uri', value: 'https://example.org/Q123' }
    }),
    null
  );
  const lead = mapWikidataBindingToLead({
    ...cafeBinding,
    coord: { type: 'literal', value: 'Point(999 1000)' }
  });
  assert.ok(lead);
  assert.equal(lead.latitude, undefined);
  assert.equal(lead.longitude, undefined);

  const unsafeWebsite = mapWikidataBindingToLead({
    ...cafeBinding,
    website: { type: 'uri', value: 'javascript:alert(1)' }
  });
  assert.ok(unsafeWebsite);
  assert.equal(unsafeWebsite.businessWebsite, '');
});

test('deduplicates source records by Wikidata entity identity', () => {
  const first = mapWikidataBindingToLead(cafeBinding);
  const duplicate = mapWikidataBindingToLead({ ...cafeBinding });
  assert.ok(first && duplicate);
  const result = filterAndDeduplicateLeads([first, duplicate]);
  assert.equal(result.validRecordsCount, 2);
  assert.equal(result.duplicateBusinessesRemoved, 1);
  assert.equal(result.finalUniqueLeads.length, 1);
});

test('sends a URL-encoded SPARQL POST and accepts only valid result records', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const provider = new WikidataLeadProvider(
    undefined,
    async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ results: { bindings: [cafeBinding] } }), { status: 200 });
    }
  );

  const leads = await provider.search(filters);
  assert.equal(requestUrl, 'https://query.wikidata.org/sparql');
  assert.equal(requestInit?.method, 'POST');
  assert.equal(
    (requestInit?.headers as Record<string, string>).Accept,
    'application/sparql-results+json'
  );
  assert.match(String(requestInit?.body), /^query=/);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].companyName, 'Cafe Mondegar');
});

test('returns an empty record list for a valid empty source response', async () => {
  const provider = new WikidataLeadProvider(
    undefined,
    async () => new Response(JSON.stringify({ results: { bindings: [] } }), { status: 200 })
  );
  assert.deepEqual(await provider.search(filters), []);
});

test('reports upstream HTTP failures and malformed response shapes explicitly', async () => {
  const unavailable = new WikidataLeadProvider(
    undefined,
    async () => new Response('unavailable', { status: 503 })
  );
  await assert.rejects(
    unavailable.search(filters),
    (error: unknown) =>
      error instanceof WikidataProviderError &&
      error.httpStatus === 503 &&
      /temporarily unavailable/.test(error.message)
  );

  const malformed = new WikidataLeadProvider(
    undefined,
    async () => new Response(JSON.stringify({ results: {} }), { status: 200 })
  );
  await assert.rejects(malformed.search(filters), /invalid result shape/);
});

test('aborts a stalled request at its configured request deadline', async () => {
  let wasAborted = false;
  const provider = new WikidataLeadProvider(
    undefined,
    async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        wasAborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }),
    5
  );
  await assert.rejects(
    provider.search(filters),
    (error: unknown) =>
      error instanceof WikidataProviderError &&
      error.timedOut &&
      /timed out \(5ms\)/.test(error.message)
  );
  assert.equal(wasAborted, true);
});

test('selects Wikidata explicitly and health checks fail when no businesses are mapped', async () => {
  assert.deepEqual(ServerLeadProviderService.resolveApiKey(undefined, 'wikidata'), {
    key: '',
    type: 'wikidata'
  });

  const searchDescriptor = Object.getOwnPropertyDescriptor(WikidataLeadProvider.prototype, 'search');
  Object.defineProperty(WikidataLeadProvider.prototype, 'search', {
    configurable: true,
    value: async () => []
  });
  try {
    const result = await ServerLeadProviderService.testConnection(undefined, 'wikidata');
    assert.equal(result.success, false);
    assert.equal(result.httpStatus, 503);
    assert.equal(result.placesReturned, 0);
    assert.match(result.message, /returned no cafe records/);

    Object.defineProperty(WikidataLeadProvider.prototype, 'search', {
      configurable: true,
      value: async () => [mapWikidataBindingToLead(cafeBinding)]
    });
    const liveRecordResult = await ServerLeadProviderService.testConnection(undefined, 'wikidata');
    assert.equal(liveRecordResult.success, true);
    assert.equal(liveRecordResult.placesReturned, 1);
    assert.match(liveRecordResult.message, /Coverage is incomplete/);
  } finally {
    if (searchDescriptor) {
      Object.defineProperty(WikidataLeadProvider.prototype, 'search', searchDescriptor);
    } else {
      delete (WikidataLeadProvider.prototype as { search?: unknown }).search;
    }
  }
});

test('routes Wikidata records and provider failures through the lead-search API', async () => {
  const searchDescriptor = Object.getOwnPropertyDescriptor(WikidataLeadProvider.prototype, 'search');
  const app = express();
  app.use(apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/search-leads`;

  try {
    const lead = mapWikidataBindingToLead(cafeBinding);
    assert.ok(lead);
    Object.defineProperty(WikidataLeadProvider.prototype, 'search', {
      configurable: true,
      value: async () => [lead]
    });
    const successResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters, providerType: 'wikidata' })
    });
    const success = await successResponse.json();
    assert.equal(successResponse.status, 200);
    assert.equal(success.provider.id, 'wikidata-cafe-provider');
    assert.equal(success.leads[0].source, 'Wikidata Query Service');
    assert.equal(success.leads[0].businessPhone, '');

    Object.defineProperty(WikidataLeadProvider.prototype, 'search', {
      configurable: true,
      value: async () => []
    });
    const emptyResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters, providerType: 'wikidata' })
    });
    assert.equal(emptyResponse.status, 404);
    assert.equal((await emptyResponse.json()).code, 'WIKIDATA_NO_RESULTS');

    Object.defineProperty(WikidataLeadProvider.prototype, 'search', {
      configurable: true,
      value: async () => {
        throw new WikidataProviderError('Wikidata Query Service request timed out (8000ms).', undefined, true);
      }
    });
    const originalConsoleError = console.error;
    console.error = () => {};
    let timeoutResponse: Response;
    try {
      timeoutResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, providerType: 'wikidata' })
      });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(timeoutResponse.status, 504);
    assert.equal((await timeoutResponse.json()).code, 'WIKIDATA_TIMEOUT');
  } finally {
    if (searchDescriptor) {
      Object.defineProperty(WikidataLeadProvider.prototype, 'search', searchDescriptor);
    } else {
      delete (WikidataLeadProvider.prototype as { search?: unknown }).search;
    }
    server.close();
    await once(server, 'close');
  }
});
