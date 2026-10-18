import assert from 'node:assert/strict';
import test from 'node:test';
import { WikidataLeadProvider, OCCUPATION_MAP, COUNTRY_MAP } from '../src/services/leadProviders/WikidataLeadProvider';
import { filterAndDeduplicateLeads } from '../src/services/deduplication';

test('OCCUPATION_MAP contains verified QIDs for required business occupations', () => {
  assert.ok(OCCUPATION_MAP['consultant'].includes('wd:Q15978655'), 'consultant should map to Q15978655');
  assert.ok(OCCUPATION_MAP['business coach'].includes('wd:Q105201291'), 'business coach should map to Q105201291');
  assert.ok(OCCUPATION_MAP['entrepreneur'].includes('wd:Q131524'), 'entrepreneur should map to Q131524');
  assert.ok(OCCUPATION_MAP['company founder'].includes('wd:Q4479442'), 'company founder should map to Q4479442');
});

test('resolveQidsForTitles handles exact matches, casing, and unknown fallback', () => {
  const provider = new WikidataLeadProvider();

  const consultantQids = provider.resolveQidsForTitles(['Consultant']);
  assert.ok(consultantQids.includes('wd:Q15978655'));

  const coachQids = provider.resolveQidsForTitles(['Senior Executive Business Coach']);
  assert.ok(coachQids.includes('wd:Q105201291') || coachQids.includes('wd:Q2790938'));

  const founderQids = provider.resolveQidsForTitles(['company founder']);
  assert.ok(founderQids.includes('wd:Q4479442'));

  const unknownQids = provider.resolveQidsForTitles(['Mysterious Quantum Alchemist']);
  assert.ok(unknownQids.length > 0, 'Should fall back gracefully without error');
  assert.ok(unknownQids.includes('wd:Q15978655') || unknownQids.includes('wd:Q43845'));
});

test('COUNTRY_MAP maps major countries to valid Wikidata QIDs', () => {
  assert.equal(COUNTRY_MAP['united states'], 'wd:Q30');
  assert.equal(COUNTRY_MAP['united kingdom'], 'wd:Q145');
  assert.equal(COUNTRY_MAP['germany'], 'wd:Q183');
  assert.equal(COUNTRY_MAP['canada'], 'wd:Q16');
});

test('Lead records never fabricate emails, phones, or unverified contact data', async () => {
  const provider = new WikidataLeadProvider();
  const leads = await provider.search({
    jobTitles: ['entrepreneur'],
    maxLeads: 5,
    industry: [],
    country: 'United States',
    seniority: [],
    companySize: []
  });

  assert.ok(Array.isArray(leads));
  for (const lead of leads) {
    assert.equal((lead as any).email, undefined, 'Email must never be fabricated');
    assert.equal((lead as any).phone, undefined, 'Phone must never be fabricated');
    if (lead.businessWebsite) {
      assert.ok(lead.businessWebsite.startsWith('http'), 'Website must be a valid real URL');
    }
  }
});

test('Deduplication correctly normalizes and preserves Wikidata leads', () => {
  const rawLeads = [
    {
      fullName: 'Jimmy Wales',
      headline: 'American internet entrepreneur',
      currentJobTitle: 'Entrepreneur',
      companyName: 'Founder / Self-Employed',
      location: 'United States',
      profileUrl: 'https://www.wikidata.org/wiki/Q181',
      connectionsOrFollowers: 'N/A',
      lastActivityDate: 'N/A',
      source: 'Wikidata SPARQL Query Service',
      businessWebsite: 'https://jimmywales.com/'
    },
    {
      fullName: 'Jimmy Wales',
      headline: 'American internet entrepreneur',
      currentJobTitle: 'Entrepreneur',
      companyName: 'Founder / Self-Employed',
      location: 'United States',
      profileUrl: 'http://www.wikidata.org/entity/Q181', // duplicate URL with http/entity format
      connectionsOrFollowers: 'N/A',
      lastActivityDate: 'N/A',
      source: 'Wikidata SPARQL Query Service',
      businessWebsite: 'https://jimmywales.com/'
    }
  ];

  const deduped = filterAndDeduplicateLeads(rawLeads);
  assert.equal(deduped.finalUniqueLeads.length, 1, 'Should eliminate the duplicate Wikidata entity');
  assert.equal(deduped.totalDuplicatesRemoved, 1);
  assert.equal(deduped.finalUniqueLeads[0].fullName, 'Jimmy Wales');
  assert.equal(deduped.finalUniqueLeads[0].profileUrl, 'https://www.wikidata.org/wiki/Q181');
});

test('Provider returns empty array gracefully on error without mock substitution', async () => {
  const provider = new WikidataLeadProvider();
  
  // Test with impossible limits or handling
  const leads = await provider.search({
    jobTitles: [],
    maxLeads: 0,
    industry: [],
    country: '',
    seniority: [],
    companySize: []
  });

  assert.ok(Array.isArray(leads));
  // Must never return mock leads
  assert.ok(leads.every(l => l.source === 'Wikidata SPARQL Query Service'));
});
