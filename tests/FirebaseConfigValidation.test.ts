import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('Firebase configuration consistency check for linkedin-tool-510912', () => {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  assert.equal(fs.existsSync(configPath), true, 'firebase-applet-config.json must exist');
  
  const content = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(content);

  assert.equal(config.projectId, 'linkedin-tool-510912', 'Project ID must be linkedin-tool-510912');
  assert.equal(config.authDomain, 'linkedin-tool-510912.firebaseapp.com', 'Auth domain must match project');
  assert.equal(config.messagingSenderId, '686590748568', 'messagingSenderId must be 686590748568');
  assert.equal(config.appId, '1:686590748568:web:586515f694e144b3476ded', 'App ID must match genuine project 686590748568 Web App');
  assert.equal(config.apiKey, 'AIzaSyC56Ke1o0tGoeRfZvysQ_DrLuI3JcUBj94', 'API key must match the provided one');
  assert.ok(config.authDomain.startsWith(config.projectId), 'authDomain must match projectId');
});

test('Firebase authDomain conforms to canonical Firebase format without path or protocol', () => {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert.equal(config.authDomain.includes('https://'), false, 'authDomain should not include protocol');
  assert.equal(config.authDomain.includes('/'), false, 'authDomain should not include path or trailing slash');
  assert.match(config.authDomain, /^[a-z0-9\-]+\.firebaseapp\.com$/, 'authDomain must be a valid firebaseapp.com domain');
});
