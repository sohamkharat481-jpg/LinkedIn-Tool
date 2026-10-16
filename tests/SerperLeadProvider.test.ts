import assert from 'node:assert/strict';
import test from 'node:test';
import { LeadFilter } from '../src/types';
import { isValidLeadRecord } from '../src/services/deduplication';
import { SerperSearchLeadProvider } from '../src/services/leadProviders/SerperSearchLeadProvider';

const filters: LeadFilter = {
  jobTitles: ['Founder'],
  industry: ['Technology'],
  country: 'India',
  city: 'Mumbai',
  seniority: [],
  companySize: [],
  maxLeads: 10
};

test('Serper extraction uses source title fields and leaves unverified location empty', () => {
  const provider = new SerperSearchLeadProvider('test-key');
  const lead = provider.extractLeadRecord(
    {
      title: 'Asha Mehta - Founder at Acme Labs | LinkedIn',
      snippet: 'Founder building developer tools.',
      link: 'https://www.linkedin.com/in/asha-mehta/'
    },
    filters
  );

  assert.ok(lead);
  assert.equal(lead.fullName, 'Asha Mehta');
  assert.equal(lead.currentJobTitle, 'Founder');
  assert.equal(lead.companyName, 'Acme Labs');
  assert.equal(lead.location, '');
});

test('Serper extraction rejects records without source job title or company details', () => {
  const provider = new SerperSearchLeadProvider('test-key');

  assert.equal(
    provider.extractLeadRecord(
      {
        title: 'Asha Mehta | LinkedIn',
        link: 'https://www.linkedin.com/in/asha-mehta/'
      },
      filters
    ),
    null
  );
});

test('lead validation rejects placeholder identity, title, or company values', () => {
  const candidate = {
    fullName: 'N/A',
    headline: 'N/A',
    currentJobTitle: 'N/A',
    companyName: 'N/A',
    location: '',
    profileUrl: 'https://www.linkedin.com/in/example/'
  };

  assert.equal(isValidLeadRecord(candidate), false);
});
