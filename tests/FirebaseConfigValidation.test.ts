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
  assert.ok(config.apiKey, 'API key must be present');
  assert.ok(config.appId, 'App ID must be present');
});
