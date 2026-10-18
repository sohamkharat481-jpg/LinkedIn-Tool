import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectHistoricalStatus,
  calculateRelevanceScore,
  enrichRawLead
} from '../src/services/b2bRelevanceService';
import { LeadFilter, RawLead } from '../src/types';
import { WikidataLeadProvider } from '../src/services/leadProviders/WikidataLeadProvider';

test('detectHistoricalStatus detects deceased individuals via P570 dateOfDeath and lifetime text', () => {
  // Test P570 explicit date of death
  const res1 = detectHistoricalStatus('1973-02-26T00:00:00Z', '1887-09-28T00:00:00Z', 'American business woman');
  assert.equal(res1.isDeceased, true);
  assert.equal(res1.dateOfDeath, '1973');
  assert.equal(res1.entityPeriod, 'deceased');
  assert.match(res1.reason, /Documented date of death/);

  // Test description lifetime range e.g. (1926-2012)
  const res2 = detectHistoricalStatus(undefined, undefined, 'American entrepreneur and businessman (1926-2012)');
  assert.equal(res2.isDeceased, true);
  assert.equal(res2.dateOfDeath, '2012');
  assert.equal(res2.entityPeriod, 'deceased');

  // Test living modern person
  const res3 = detectHistoricalStatus(undefined, '1975-04-12T00:00:00Z', 'American technology executive and consultant');
  assert.equal(res3.isDeceased, false);
  assert.equal(res3.entityPeriod, 'modern');
});

test('detectHistoricalStatus distinguishes historical figures without inferring current activity solely from age', () => {
  // Historical figure born in 1845 without explicit death date
  const hist = detectHistoricalStatus(undefined, '1845-05-10T00:00:00Z', 'Scottish business magnate');
  assert.equal(hist.entityPeriod, 'historical');
  assert.equal(hist.isDeceased, false); // Not recorded as dead, but historical era

  // Modern person born in 1965
  const modern = detectHistoricalStatus(undefined, '1965-08-20T00:00:00Z', 'Contemporary technology entrepreneur');
  assert.equal(modern.entityPeriod, 'modern');
  assert.equal(modern.isDeceased, false);
});

test('calculateRelevanceScore calculates transparent points without treating missing data as negative proof', () => {
  const filters: LeadFilter = {
    jobTitles: ['Consultant'],
    industry: ['Technology & SaaS'],
    country: 'United States',
    seniority: [],
    companySize: [],
    maxLeads: 10
  };

  // Lead with matching occupation, matching niche, official website, modern
  const leadWithAll = {
    fullName: 'Jane Doe',
    headline: 'Management consultant specializing in technology and software growth',
    currentJobTitle: 'Consultant',
    businessWebsite: 'https://janedoeconsulting.com',
    isDeceased: false,
    entityPeriod: 'modern' as const
  };

  const fullScore = calculateRelevanceScore(leadWithAll, filters, 'Technology');
  assert.ok(fullScore.score >= 70, `Score should be high, got ${fullScore.score}`);
  assert.equal(fullScore.classification, 'Qualified Prospect');
  assert.equal(fullScore.breakdown.occupationMatch, true);
  assert.equal(fullScore.breakdown.nicheMatch, true);
  assert.equal(fullScore.breakdown.websiteAvailable, true);
  assert.equal(fullScore.breakdown.websitePoints, 25);
  assert.match(fullScore.explanation, /Score/);

  // Lead with matching occupation, but NO official website
  const leadNoWebsite = {
    fullName: 'John Smith',
    headline: 'Strategy consultant for enterprise technology firms',
    currentJobTitle: 'Consultant',
    businessWebsite: undefined,
    isDeceased: false,
    entityPeriod: 'modern' as const
  };

  const noWebScore = calculateRelevanceScore(leadNoWebsite, filters, 'Technology');
  assert.equal(noWebScore.breakdown.websiteAvailable, false);
  assert.equal(noWebScore.breakdown.websitePoints, 0);
  // Missing website is not treated as negative proof (it gets 0, but no penalty subtraction)
  assert.ok(noWebScore.breakdown.details.some(d => d.includes('missing data not penalized')));
  // Without website, cannot be Qualified Prospect or Contact Available
  assert.equal(noWebScore.classification, 'Relevant');
});

test('lead status classification never automatically classifies discovered entities as qualified prospects', () => {
  const filters: LeadFilter = {
    jobTitles: ['Entrepreneur'],
    industry: [],
    country: 'United States',
    seniority: [],
    companySize: [],
    maxLeads: 10
  };

  // Deceased entity
  const deceasedLead = {
    fullName: 'Historical Person',
    headline: '19th century American entrepreneur (1850-1910)',
    currentJobTitle: 'Entrepreneur',
    businessWebsite: 'https://archive.org',
    isDeceased: true,
    entityPeriod: 'deceased' as const
  };

  const deceasedScore = calculateRelevanceScore(deceasedLead, filters);
  // Deceased individuals must NEVER be classified as Qualified Prospect or Relevant
  assert.equal(deceasedScore.classification, 'Discovered');

  // Generic discovered entity with low relevance (< 40)
  const lowMatchLead = {
    fullName: 'Unknown Entity',
    headline: 'Former public official',
    currentJobTitle: 'Entrepreneur',
    businessWebsite: undefined,
    isDeceased: false,
    entityPeriod: 'modern' as const
  };

  const lowScore = calculateRelevanceScore(lowMatchLead, { ...filters, jobTitles: ['Quantum Biochemist'] });
  assert.equal(lowScore.classification, 'Discovered');
});

test('contact data integrity: website only present when real, never generates fake contacts', () => {
  const rawLead: RawLead = {
    fullName: 'Test Person',
    headline: 'Founder & CEO',
    currentJobTitle: 'CEO',
    companyName: 'Test Corp',
    location: 'United States',
    profileUrl: 'https://www.wikidata.org/wiki/Q999999',
    source: 'Wikidata SPARQL Query Service',
    businessWebsite: undefined // No website in record
  };

  const enriched = enrichRawLead(rawLead, {
    jobTitles: ['CEO'],
    industry: [],
    country: 'United States',
    seniority: [],
    companySize: [],
    maxLeads: 5
  });

  assert.equal(enriched.businessWebsite, undefined, 'Must not invent website');
  assert.equal((enriched as any).businessPhone, undefined, 'Must not invent phone');
  assert.equal((enriched as any).email, undefined, 'Must not invent email');
  assert.ok(enriched.relevanceScore !== undefined, 'Must calculate transparent score');
  assert.ok(enriched.b2bClassification !== undefined, 'Must assign classification');
});

test('WikidataLeadProvider search returns genuine Wikidata entities with transparent relevance intelligence', async () => {
  const provider = new WikidataLeadProvider();
  const leads = await provider.search({
    jobTitles: ['Consultant'],
    industry: [],
    country: 'United States',
    seniority: [],
    companySize: [],
    maxLeads: 5
  });

  assert.ok(Array.isArray(leads));
  assert.ok(leads.length > 0, 'Live query should return actual Wikidata entities');

  for (const lead of leads) {
    // 1. Genuine entity verification
    assert.ok(lead.profileUrl.startsWith('http://www.wikidata.org/entity/Q') || lead.profileUrl.startsWith('https://www.wikidata.org/wiki/Q'));
    assert.ok(lead.fullName.length >= 2);
    assert.equal(lead.source, 'Wikidata SPARQL Query Service');

    // 2. Relevance score presence & range
    assert.ok(typeof lead.relevanceScore === 'number');
    assert.ok(lead.relevanceScore! >= 0 && lead.relevanceScore! <= 100);
    assert.ok(typeof lead.relevanceExplanation === 'string');

    // 3. Status classification
    assert.ok(['Discovered', 'Relevant', 'Contact Available', 'Qualified Prospect'].includes(lead.b2bClassification!));

    // 4. Contact integrity
    if (lead.businessWebsite) {
      assert.ok(lead.businessWebsite.startsWith('http'), 'Website must be a valid HTTP URL');
    }
    assert.equal((lead as any).phone, undefined, 'Never fabricate phone');
    assert.equal((lead as any).email, undefined, 'Never fabricate email');
  }
});
