import assert from 'node:assert/strict';
import test from 'node:test';
import { InstagramDiscoveryService } from '../src/server/instagramDiscoveryService';
import { WikidataLeadProvider } from '../src/services/leadProviders/WikidataLeadProvider';
import { dbService } from '../src/services/storage';
import { SupabaseDataService } from '../src/services/supabaseDataService';
import { LeadRecord } from '../src/types';

test('parseInstagramUsernameFromHtml extracts authentic profile handle and ignores reserved paths', () => {
  // 1. Valid footer link on website
  const htmlWithValidLink = `
    <html>
      <body>
        <footer>
          <a href="https://www.instagram.com/acmeconsulting/">Instagram</a>
          <a href="https://instagram.com/p/B123456789">Post</a>
          <a href="https://instagram.com/explore/">Explore</a>
        </footer>
      </body>
    </html>
  `;
  const result1 = InstagramDiscoveryService.parseInstagramUsernameFromHtml(htmlWithValidLink);
  assert.ok(result1 !== null, 'Should find authentic profile handle');
  assert.equal(result1?.username, 'acmeconsulting');

  // 2. HTML with only reserved paths (post, reel, explore, legal, etc.)
  const htmlOnlyReserved = `
    <html>
      <a href="https://www.instagram.com/p/CAbc123/">Photo</a>
      <a href="https://www.instagram.com/reel/XYZ987/">Reel</a>
      <a href="https://www.instagram.com/about/jobs/">About</a>
      <a href="https://www.instagram.com/legal/privacy/">Privacy</a>
    </html>
  `;
  const result2 = InstagramDiscoveryService.parseInstagramUsernameFromHtml(htmlOnlyReserved);
  assert.equal(result2, null, 'Should reject reserved Instagram system paths');

  // 3. HTML with asset extensions
  const htmlWithAssets = `
    <img src="https://instagram.com/logo.png" />
  `;
  const result3 = InstagramDiscoveryService.parseInstagramUsernameFromHtml(htmlWithAssets);
  assert.equal(result3, null, 'Should reject image asset URLs');
});

test('InstagramDiscoveryService assigns Verified status and authentic evidence for website discovery', async () => {
  // Test website extraction parser
  const sampleHtml = `
    <div>
      <nav>
        <a href="https://instagram.com/innovate_growth/">Follow us on Instagram</a>
      </nav>
    </div>
  `;
  const parsed = InstagramDiscoveryService.parseInstagramUsernameFromHtml(sampleHtml);
  assert.equal(parsed?.username, 'innovate_growth');

  const cleanHandle = parsed!.username;
  const verifiedUrl = `https://www.instagram.com/${cleanHandle}/`;
  assert.equal(verifiedUrl, 'https://www.instagram.com/innovate_growth/');
});

test('InstagramDiscoveryService assigns Needs Review for candidate manual handles', async () => {
  const target = {
    fullName: 'Jane Doe',
    companyName: 'Doe Advisory',
    currentUsername: '@janedoe_advisory'
  };

  const result = await InstagramDiscoveryService.discoverForLead(target);
  assert.equal(result.instagramUsername, 'janedoe_advisory');
  assert.equal(result.instagramProfileUrl, 'https://www.instagram.com/janedoe_advisory/');
  assert.equal(result.instagramVerificationStatus, 'Needs Review');
  assert.match(result.instagramVerificationEvidence, /Candidate handle/);
});

test('InstagramDiscoveryService assigns Not Found when no records or website link exist', async () => {
  const target = {
    fullName: 'Unknown Entity Without Links',
    companyName: 'No Web Corp'
  };

  const result = await InstagramDiscoveryService.discoverForLead(target);
  assert.equal(result.instagramUsername, undefined);
  assert.equal(result.instagramProfileUrl, undefined);
  assert.equal(result.instagramVerificationStatus, 'Not Found');
  assert.match(result.instagramVerificationEvidence, /No public Instagram business profile found/);
});

test('WikidataLeadProvider parses P2003 Instagram username into Verified profile fields', () => {
  const provider = new WikidataLeadProvider();
  
  // Fake binding with P2003 property from SPARQL
  const bindingWithP2003 = {
    item: { value: 'http://www.wikidata.org/entity/Q999001' },
    itemLabel: { value: 'Alex Morgan' },
    itemDescription: { value: 'Consultant and business strategist' },
    countryLabel: { value: 'United States' },
    website: { value: 'https://alexmorganconsulting.com' },
    instagram: { value: 'alexmorgan_official' }
  };

  const filters = {
    jobTitles: ['Consultant'],
    industry: [],
    country: 'United States',
    seniority: [],
    companySize: [],
    maxLeads: 5
  };

  const lead = (provider as any).toLead(bindingWithP2003, 'Consultant', filters);
  assert.ok(lead !== null);
  assert.equal(lead.instagramUsername, 'alexmorgan_official');
  assert.equal(lead.instagramProfileUrl, 'https://www.instagram.com/alexmorgan_official/');
  assert.equal(lead.instagramVerificationStatus, 'Verified');
  assert.equal(lead.instagramDiscoverySource, 'Wikidata (P2003)');
  assert.match(lead.instagramVerificationEvidence, /Official Wikidata statement \(P2003\)/);
  assert.equal(lead.contactVerificationStatus, 'Available');
});

test('storage and SupabaseDataService persist Instagram profile updates and survive retrieval', async () => {
  const wsId = 'test-ws-instagram';
  const clientId = 'test-client-instagram';

  const testLead: LeadRecord = {
    id: 'lead-test-insta-01',
    workspaceId: wsId,
    clientId: clientId,
    fullName: 'Robert Sterling',
    headline: 'Executive Coach',
    currentJobTitle: 'Executive Coach',
    companyName: 'Sterling Partners',
    location: 'United Kingdom',
    profileUrl: 'https://www.wikidata.org/wiki/Q888123',
    connectionsOrFollowers: 'N/A',
    lastActivityDate: 'N/A',
    dateAdded: '2026-10-19',
    status: 'Not Contacted',
    notes: '',
    source: 'Wikidata SPARQL Query Service',
    instagramUsername: undefined,
    instagramVerificationStatus: undefined
  };

  // 1. Save lead initially
  dbService.saveLeadsForClient(wsId, clientId, [testLead]);
  const initialLeads = dbService.getLeadsForClient(wsId, clientId);
  assert.equal(initialLeads.length, 1);
  assert.equal(initialLeads[0].instagramUsername, undefined);

  // 2. Update Instagram information
  const updated = dbService.updateLeadInstagram(wsId, testLead.id, {
    instagramUsername: 'robertsterling_coach',
    instagramProfileUrl: 'https://www.instagram.com/robertsterling_coach/',
    instagramVerificationStatus: 'Verified',
    instagramVerificationEvidence: 'Discovered on verified official website',
    instagramDiscoverySource: 'Official Business Website',
    instagramLastCheckedAt: new Date().toISOString()
  });

  assert.ok(updated !== undefined);
  assert.equal(updated?.instagramUsername, 'robertsterling_coach');
  assert.equal(updated?.instagramVerificationStatus, 'Verified');

  // 3. Confirm retrieval
  const reloaded = dbService.getLeadsForClient(wsId, clientId);
  assert.equal(reloaded[0].instagramUsername, 'robertsterling_coach');
  assert.equal(reloaded[0].instagramVerificationStatus, 'Verified');
  assert.equal(reloaded[0].instagramProfileUrl, 'https://www.instagram.com/robertsterling_coach/');

  // Clean up
  dbService.deleteLeadsForClient(wsId, clientId);
});
