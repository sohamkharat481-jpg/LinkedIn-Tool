import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('Privacy Policy view component exists and contains all required compliance disclosures', () => {
  const fileContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/PrivacyPolicyView.tsx'), 'utf8');

  // Verify application branding & URL
  assert.ok(fileContent.includes('LinkedIn Lead Finder'), 'Privacy Policy must disclose Application Name');
  assert.ok(fileContent.includes('https://linked-in-tool-beta.vercel.app/privacy') || fileContent.includes('/privacy'), 'Must include canonical Privacy Policy route');

  // Verify Google OAuth Scope & Sheets disclosures
  assert.ok(fileContent.includes('https://www.googleapis.com/auth/spreadsheets'), 'Must explicitly disclose Google Spreadsheets OAuth scope');
  assert.ok(fileContent.includes('Google'), 'Must detail Google authentication and integration');

  // Verify infrastructure & service provider disclosures
  assert.ok(fileContent.includes('Firebase'), 'Must disclose Firebase Authentication provider');
  assert.ok(fileContent.includes('Supabase'), 'Must disclose Supabase database provider');
  assert.ok(fileContent.includes('Wikidata'), 'Must disclose Wikidata provider for public B2B searches');

  // Verify retention, rights, and contact info
  assert.ok(fileContent.includes('sohamkharat481@gmail.com'), 'Must state contact email for privacy requests');
  assert.ok(fileContent.includes('October 25, 2026'), 'Must state effective / last updated date');
});

test('Terms of Service view component exists and contains all required terms and limitations', () => {
  const fileContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/TermsOfServiceView.tsx'), 'utf8');

  // Verify application branding & URL
  assert.ok(fileContent.includes('LinkedIn Lead Finder'), 'Terms of Service must disclose Application Name');
  assert.ok(fileContent.includes('https://linked-in-tool-beta.vercel.app/terms') || fileContent.includes('/terms'), 'Must include canonical Terms route');

  // Verify acceptable use and rules
  assert.ok(fileContent.includes('CAN-SPAM') || fileContent.includes('GDPR'), 'Must detail compliance with anti-spam and privacy laws');
  assert.ok(fileContent.includes('Scraping') || fileContent.includes('Abuse'), 'Must prohibit system abuse and unlawful scraping');
  assert.ok(fileContent.includes('AS IS'), 'Must include disclaimer of warranties');

  // Verify contact info
  assert.ok(fileContent.includes('sohamkharat481@gmail.com'), 'Must state legal contact email');
});

test('App.tsx integrates unauthenticated routing for /privacy and /terms', () => {
  const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

  assert.ok(appContent.includes("currentPath === '/privacy'"), 'App.tsx must handle /privacy route');
  assert.ok(appContent.includes("currentPath === '/terms'"), 'App.tsx must handle /terms route');
  assert.ok(appContent.includes('PrivacyPolicyView'), 'App.tsx must import PrivacyPolicyView');
  assert.ok(appContent.includes('TermsOfServiceView'), 'App.tsx must import TermsOfServiceView');

  // Confirm route handling occurs before login block
  const privacyRouteIndex = appContent.indexOf("currentPath === '/privacy'");
  const loginBlockIndex = appContent.indexOf('if (!firebaseUser)');
  assert.ok(privacyRouteIndex < loginBlockIndex, '/privacy route check must precede the authentication guard');
});

test('LoginScreen.tsx and Sidebar.tsx contain accessible links to Privacy Policy and Terms of Service', () => {
  const loginContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/LoginScreen.tsx'), 'utf8');
  assert.ok(loginContent.includes('/privacy'), 'LoginScreen must link to /privacy');
  assert.ok(loginContent.includes('/terms'), 'LoginScreen must link to /terms');

  const sidebarContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8');
  assert.ok(sidebarContent.includes('/privacy'), 'Sidebar must link to /privacy');
  assert.ok(sidebarContent.includes('/terms'), 'Sidebar must link to /terms');
});
