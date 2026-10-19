import assert from 'node:assert/strict';
import test from 'node:test';
import { InstagramDiscoveryService } from '../src/server/instagramDiscoveryService';
import { dbService } from '../src/services/storage';
import { LeadRecord } from '../src/types';

test('1. Phone extraction from tel: links with valid formatting', () => {
  const html = '<a href="tel:+1-555-0199">Call</a>';
  const phone = InstagramDiscoveryService.parsePhoneFromHtml(html);
  assert.equal(phone, '+1-555-0199');
});

test('2. Rejection of unrelated numeric strings and script identifiers in tel: links', () => {
  const html = '<a href="tel:1766094313">Track</a>';
  const phone = InstagramDiscoveryService.parsePhoneFromHtml(html);
  assert.equal(phone, undefined, 'Should reject raw unformatted ID numbers without phone separators');
});

test('3. Visible phone number parsing with standard formatting separators', () => {
  const html = '<p>Contact us at (555) 123-4567 today.</p>';
  const phone = InstagramDiscoveryService.parsePhoneFromHtml(html);
  assert.equal(phone, '(555) 123-4567');
});

test('4. Instagram status and handle consistency', async () => {
  const target = {
    fullName: 'Jane Test',
    currentUsername: 'janetest_official'
  };
  const res = await InstagramDiscoveryService.discoverForLead(target);
  assert.equal(res.instagramUsername, 'janetest_official');
  assert.equal(res.instagramVerificationStatus, 'Needs Review');
});

test('5. Save and reload persistence of enriched contact and Instagram details', () => {
  const wsId = 'ws-regression-test';
  const clientId = 'client-regression-test';

  const lead: LeadRecord = {
    id: 'lead-reg-01',
    workspaceId: wsId,
    clientId: clientId,
    fullName: 'Test Lead',
    headline: 'Consultant',
    currentJobTitle: 'Consultant',
    companyName: 'Corp',
    location: 'US',
    profileUrl: 'https://wikidata.org/wiki/Q111',
    businessWebsite: 'https://example.com',
    businessEmail: 'info@example.com',
    businessPhone: '+1-555-0100',
    instagramUsername: 'test_insta',
    instagramProfileUrl: 'https://instagram.com/test_insta/',
    instagramVerificationStatus: 'Verified',
    instagramVerificationEvidence: 'Source-backed',
    instagramDiscoverySource: 'Official Website',
    connectionsOrFollowers: 'N/A',
    lastActivityDate: 'N/A',
    dateAdded: '2026-10-19',
    status: 'Not Contacted',
    notes: '',
    source: 'Wikidata'
  };

  dbService.saveLeadsForClient(wsId, clientId, [lead]);
  const reloaded = dbService.getLeadsForClient(wsId, clientId)[0];

  assert.equal(reloaded.businessEmail, 'info@example.com');
  assert.equal(reloaded.businessPhone, '+1-555-0100');
  assert.equal(reloaded.instagramUsername, 'test_insta');
  assert.equal(reloaded.instagramVerificationStatus, 'Verified');

  dbService.deleteLeadsForClient(wsId, clientId);
});
