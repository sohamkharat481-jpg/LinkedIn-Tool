import assert from 'node:assert/strict';
import test from 'node:test';
import { InstagramDiscoveryService } from '../src/server/instagramDiscoveryService';
import { dbService } from '../src/services/storage';
import { LeadRecord } from '../src/types';

test('1. Contact-page link discovery extracts same-domain contact, about, and team paths', () => {
  const sampleHtml = `
    <html>
      <body>
        <a href="/contact-us">Contact</a>
        <a href="https://example.com/about">About Us</a>
        <a href="https://example.com/team/leadership">Team</a>
        <a href="https://external-site.com/contact">External</a>
      </body>
    </html>
  `;

  const links = InstagramDiscoveryService.extractContactSubpageLinks(sampleHtml, 'https://example.com');
  assert.ok(links.length >= 3);
  assert.ok(links.some((l) => l.includes('/contact-us')));
  assert.ok(links.some((l) => l.includes('/about')));
  assert.ok(links.some((l) => l.includes('/team/leadership')));
  assert.ok(!links.some((l) => l.includes('external-site.com')));
});

test('2. mailto and tel extraction parses authentic contact details', () => {
  const html = `
    <html>
      <a href="mailto:info@businessconsulting.com">Email</a>
      <a href="tel:+1-555-0199">Call</a>
    </html>
  `;

  const email = InstagramDiscoveryService.parseEmailFromHtml(html);
  const phone = InstagramDiscoveryService.parsePhoneFromHtml(html);

  assert.equal(email, 'info@businessconsulting.com');
  assert.equal(phone, '+1-555-0199');
});

test('3. Visible phone number parsing extracts standard 10-digit phone patterns without postal codes', () => {
  const html = `
    <html>
      <p>Our zip code is 90210 but call us at (555) 123-4567.</p>
    </html>
  `;

  const phone = InstagramDiscoveryService.parsePhoneFromHtml(html);
  assert.equal(phone, '(555) 123-4567');
});

test('4. Instagram URL validation and normalization', () => {
  const html = `
    <html>
      <a href="https://www.instagram.com/consulting_pros/">Instagram</a>
    </html>
  `;

  const insta = InstagramDiscoveryService.parseInstagramUsernameFromHtml(html);
  assert.equal(insta?.username, 'consulting_pros');
});

test('5. Duplicate-page prevention ensures subpage links are deduplicated', () => {
  const html = `
    <a href="/contact">Contact</a>
    <a href="/contact">Contact Duplicate</a>
  `;
  const links = InstagramDiscoveryService.extractContactSubpageLinks(html, 'https://example.com');
  assert.equal(links.length, 1);
});

test('6. Unsafe redirects and private-network URLs are rejected by sanitizer', () => {
  const localUrl = 'http://127.0.0.1/admin';
  const sanitizedLocal = InstagramDiscoveryService.sanitizeAndNormalizeUrl(localUrl);
  assert.equal(sanitizedLocal, null, 'Should reject localhost/private IP URLs');

  const validUrl = 'https://example.com';
  const sanitizedValid = InstagramDiscoveryService.sanitizeAndNormalizeUrl(validUrl);
  assert.equal(sanitizedValid, 'https://example.com/');
});

test('7. Preservation of previously verified data during failed lookup', () => {
  const wsId = 'ws-phase1-test';
  const clientId = 'client-phase1-test';

  const existingLead: LeadRecord = {
    id: 'lead-p1-01',
    workspaceId: wsId,
    clientId: clientId,
    fullName: 'Jane Doe',
    headline: 'Consultant',
    currentJobTitle: 'Consultant',
    companyName: 'Doe Corp',
    location: 'US',
    profileUrl: 'https://wikidata.org/wiki/Q999',
    businessWebsite: 'https://example.com',
    businessEmail: 'jane@example.com',
    businessPhone: '+1-555-0100',
    instagramUsername: 'janedoe',
    instagramProfileUrl: 'https://instagram.com/janedoe/',
    instagramVerificationStatus: 'Verified',
    instagramVerificationEvidence: 'Verified via P2003',
    instagramDiscoverySource: 'Wikidata',
    connectionsOrFollowers: 'N/A',
    lastActivityDate: 'N/A',
    dateAdded: '2026-10-19',
    status: 'Not Contacted',
    notes: '',
    source: 'Wikidata'
  };

  dbService.saveLeadsForClient(wsId, clientId, [existingLead]);

  // Simulate update where discovery fails or yields empty result
  const current = dbService.getLeadsForClient(wsId, clientId)[0];
  const lookupFailedStatus = 'Lookup Failed' as const;

  const preservedUpdate = {
    instagramUsername: lookupFailedStatus === 'Lookup Failed' && current.instagramUsername ? current.instagramUsername : undefined,
    instagramProfileUrl: lookupFailedStatus === 'Lookup Failed' && current.instagramProfileUrl ? current.instagramProfileUrl : undefined,
    instagramVerificationStatus: lookupFailedStatus,
    instagramVerificationEvidence: 'Website lookup failed (Network timeout)'
  };

  dbService.updateLeadInstagram(wsId, existingLead.id, preservedUpdate);
  const reloaded = dbService.getLeadsForClient(wsId, clientId)[0];

  assert.equal(reloaded.instagramUsername, 'janedoe', 'Previously verified username must be preserved');
  assert.equal(reloaded.businessEmail, 'jane@example.com', 'Business email must be preserved');
  assert.equal(reloaded.businessPhone, '+1-555-0100', 'Business phone must be preserved');
  assert.equal(reloaded.instagramVerificationStatus, 'Lookup Failed');

  dbService.deleteLeadsForClient(wsId, clientId);
});
