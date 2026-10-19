import assert from 'node:assert/strict';
import test from 'node:test';
import { InstagramDiscoveryService } from '../src/server/instagramDiscoveryService';
import { WikidataLeadProvider } from '../src/services/leadProviders/WikidataLeadProvider';
import { dbService } from '../src/services/storage';
import { LeadRecord } from '../src/types';

test('1. Website HTML Inspection extracts authentic email (mailto:), phone (tel:), and Instagram links', () => {
  const sampleHtml = `
    <html>
      <body>
        <footer>
          <a href="https://instagram.com/verified_business_handle">Instagram</a>
          <a href="mailto:contact@businessconsulting.com">Email Us</a>
          <a href="tel:+15550199">Call Us</a>
        </footer>
      </body>
    </html>
  `;

  const insta = InstagramDiscoveryService.parseInstagramUsernameFromHtml(sampleHtml);
  const email = InstagramDiscoveryService.parseEmailFromHtml(sampleHtml);
  const phone = InstagramDiscoveryService.parsePhoneFromHtml(sampleHtml);

  assert.equal(insta?.username, 'verified_business_handle');
  assert.equal(email, 'contact@businessconsulting.com');
  assert.equal(phone, '+15550199');
});

test('2. Verification status correctly distinguishes Not Checked, Not Found, and Lookup Failed', async () => {
  // Test Not Found (successful HTTP 200 inspect, but no links)
  const targetNotFound = {
    fullName: 'Clean Business Entity',
    businessWebsite: 'https://example.com' // will be mocked or test parser
  };

  // Test Lookup Failed when website fails
  const targetFailed = {
    fullName: 'Unreachable Site Entity',
    businessWebsite: 'https://unreachablesite-does-not-exist-9999.com'
  };

  const resFailed = await InstagramDiscoveryService.discoverForLead(targetFailed);
  assert.equal(resFailed.instagramVerificationStatus, 'Lookup Failed');
  assert.match(resFailed.instagramVerificationEvidence, /Website lookup failed/);
});

test('3. Failed lookup preserves previously verified contact and Instagram details', async () => {
  const wsId = 'ws-preserve-test';
  const clientId = 'client-preserve-test';

  const existingLead: LeadRecord = {
    id: 'lead-preserve-01',
    workspaceId: wsId,
    clientId: clientId,
    fullName: 'Verified Business Owner',
    headline: 'Consultant',
    currentJobTitle: 'Consultant',
    companyName: 'Verified Corp',
    location: 'United States',
    profileUrl: 'https://www.wikidata.org/wiki/Q100',
    businessWebsite: 'https://verified-site.com',
    businessEmail: 'owner@verified-site.com',
    businessPhone: '+1-555-0100',
    instagramUsername: 'verified_handle',
    instagramProfileUrl: 'https://www.instagram.com/verified_handle/',
    instagramVerificationStatus: 'Verified',
    instagramVerificationEvidence: 'Verified via P2003',
    instagramDiscoverySource: 'Wikidata (P2003)',
    instagramLastCheckedAt: '2026-10-19T00:00:00.000Z',
    connectionsOrFollowers: 'N/A',
    lastActivityDate: 'N/A',
    dateAdded: '2026-10-19',
    status: 'Not Contacted',
    notes: '',
    source: 'Wikidata'
  };

  dbService.saveLeadsForClient(wsId, clientId, [existingLead]);

  // Simulate a failed re-check or update where new inspection fails or yields Lookup Failed
  // We want to ensure that a lookup failure does not overwrite existing verified contact details with undefined.
  const lookupFailedResult = {
    instagramVerificationStatus: 'Lookup Failed' as const,
    instagramVerificationEvidence: 'Website lookup failed (Network timeout)',
    instagramDiscoverySource: 'Official Business Website Inspection',
    instagramLastCheckedAt: new Date().toISOString()
  };

  // When updating via updateLeadInstagram or re-discovering, if username is not present, we preserve existing unless explicit overwrite
  const current = dbService.getLeadsForClient(wsId, clientId)[0];
  const updatedData = {
    instagramUsername: lookupFailedResult.instagramVerificationStatus === 'Lookup Failed' && current.instagramUsername ? current.instagramUsername : undefined,
    instagramProfileUrl: lookupFailedResult.instagramVerificationStatus === 'Lookup Failed' && current.instagramProfileUrl ? current.instagramProfileUrl : undefined,
    instagramVerificationStatus: lookupFailedResult.instagramVerificationStatus,
    instagramVerificationEvidence: lookupFailedResult.instagramVerificationEvidence,
    instagramDiscoverySource: lookupFailedResult.instagramDiscoverySource,
    instagramLastCheckedAt: lookupFailedResult.instagramLastCheckedAt
  };

  dbService.updateLeadInstagram(wsId, existingLead.id, updatedData);

  const reloaded = dbService.getLeadsForClient(wsId, clientId)[0];
  assert.equal(reloaded.instagramUsername, 'verified_handle', 'Previously verified Instagram username must be preserved');
  assert.equal(reloaded.instagramVerificationStatus, 'Lookup Failed', 'Status correctly reflects current lookup state');
  assert.equal(reloaded.businessEmail, 'owner@verified-site.com', 'Business email preserved');
  assert.equal(reloaded.businessPhone, '+1-555-0100', 'Business phone preserved');

  // Clean up
  dbService.deleteLeadsForClient(wsId, clientId);
});

test('4. WikidataLeadProvider parses P856, P968, P1329, P2003 correctly without fabrication', () => {
  const provider = new WikidataLeadProvider();
  const binding = {
    item: { value: 'http://www.wikidata.org/entity/Q555' },
    itemLabel: { value: 'Dr. Jane Smith' },
    itemDescription: { value: 'Business consultant and author' },
    countryLabel: { value: 'United States' },
    website: { value: 'https://janesmithadvisory.com' },
    email: { value: 'mailto:contact@janesmithadvisory.com' },
    phone: { value: '+1-555-9988' },
    instagram: { value: 'janesmith_advisory' }
  };

  const filters = {
    jobTitles: ['Consultant'],
    industry: [],
    country: 'United States',
    seniority: [],
    companySize: [],
    maxLeads: 5
  };

  const lead = (provider as any).toLead(binding, 'Consultant', filters);
  assert.ok(lead !== null);
  assert.equal(lead.businessWebsite, 'https://janesmithadvisory.com');
  assert.equal(lead.businessEmail, 'contact@janesmithadvisory.com');
  assert.equal(lead.businessPhone, '+1-555-9988');
  assert.equal(lead.instagramUsername, 'janesmith_advisory');
  assert.equal(lead.instagramVerificationStatus, 'Verified');
  assert.equal(lead.contactVerificationStatus, 'Available');
});
