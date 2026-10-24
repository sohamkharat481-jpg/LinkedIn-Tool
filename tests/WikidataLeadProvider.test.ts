import test from 'node:test';
import assert from 'node:assert/strict';
import { WikidataLeadProvider, OCCUPATION_MAP, COUNTRY_MAP } from '../src/services/leadProviders/WikidataLeadProvider';
import { LeadFilter } from '../src/types';

test('WikidataLeadProvider resolves executive and job title QIDs correctly', () => {
  const provider = new WikidataLeadProvider();
  
  const qids = provider.resolveQidsForTitles(['Founder', 'CEO', 'Marketing Manager', 'VP of Sales', 'Director', 'VP', 'C-Level']);
  assert.ok(qids.length >= 3, 'Should resolve multiple QIDs for executive titles');
  assert.ok(qids.includes('wd:Q4479442') || qids.includes('wd:Q131524'), 'Should include founder/entrepreneur QIDs');
  assert.ok(qids.includes('wd:Q484876') || qids.includes('wd:Q43845'), 'Should include CEO/businessperson QIDs');
  assert.ok(qids.includes('wd:Q3455803') || qids.includes('wd:Q1622275'), 'Should include director/manager QIDs');
});

test('WikidataLeadProvider maps country names to Wikidata QIDs', () => {
  assert.equal(COUNTRY_MAP['india'], 'wd:Q668');
  assert.equal(COUNTRY_MAP['united states'], 'wd:Q30');
  assert.equal(COUNTRY_MAP['united kingdom'], 'wd:Q145');
});

test('WikidataLeadProvider executes real search for India executive leads and returns genuine records', async () => {
  const provider = new WikidataLeadProvider();
  const filters: LeadFilter = {
    country: 'India',
    jobTitles: ['Founder', 'CEO', 'Marketing Manager', 'VP of Sales'],
    seniority: ['Director', 'VP', 'C-Level'],
    industry: ['Technology & SaaS'],
    companySize: ['11-50', '51-200'],
    maxLeads: 20
  };

  const leads = await provider.search(filters);
  assert.ok(Array.isArray(leads), 'Result should be an array');
  assert.ok(leads.length > 0, `Expected real leads from Wikidata for India, found ${leads.length}`);

  const sample = leads[0];
  assert.ok(sample.fullName && sample.fullName.trim().length > 1, 'Lead must have valid full name');
  assert.ok(sample.profileUrl && sample.profileUrl.startsWith('http'), 'Lead must have valid profile URL');
  assert.ok(sample.location && sample.location.length > 0, 'Lead must have location');
  assert.ok(typeof sample.relevanceScore === 'number', 'Lead must have relevance score');
});
