import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerLeadProviderService } from '../src/server/leadProviderService';
import { ProviderFactory } from '../src/services/leadProviders/ProviderFactory';

test('the server supports only the remaining explicit providers', () => {
  assert.equal(ServerLeadProviderService.resolveApiKey(undefined, 'serper').type, 'serper');
  assert.equal(ServerLeadProviderService.resolveApiKey(undefined, 'leadocean').type, 'leadocean');
  assert.equal(
    ServerLeadProviderService.resolveApiKey(undefined, 'instagram_business').type,
    'instagram_business'
  );

  for (const removedProvider of ['google_search', 'google_places', 'overpass', 'wikidata']) {
    assert.throws(
      () => ServerLeadProviderService.resolveApiKey(undefined, removedProvider),
      /Unsupported lead provider/
    );
  }
});

test('the provider factory creates the explicitly selected Instagram provider', () => {
  ProviderFactory.configure({
    providerType: 'instagram_business',
    apiKey: '',
    customEndpoint: ''
  });

  assert.equal(
    ProviderFactory.getProvider().providerId,
    'instagram-business-discovery-provider'
  );

  ProviderFactory.configure({
    providerType: 'serper',
    apiKey: '',
    customEndpoint: ''
  });
});

test('provider diagnostics report Instagram configuration without exposing credential values', () => {
  const originalToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const originalUserId = process.env.INSTAGRAM_USER_ID;
  const token = 'test-only-meta-token';

  try {
    process.env.INSTAGRAM_ACCESS_TOKEN = token;
    process.env.INSTAGRAM_USER_ID = '123456789';

    const diagnostics = ServerLeadProviderService.getDiagnostics();
    const serialized = JSON.stringify(diagnostics);

    assert.equal(diagnostics.INSTAGRAM_ACCESS_TOKEN, 'CONFIGURED');
    assert.equal(diagnostics.INSTAGRAM_USER_ID, 'CONFIGURED');
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes('123456789'), false);
  } finally {
    if (originalToken === undefined) delete process.env.INSTAGRAM_ACCESS_TOKEN;
    else process.env.INSTAGRAM_ACCESS_TOKEN = originalToken;
    if (originalUserId === undefined) delete process.env.INSTAGRAM_USER_ID;
    else process.env.INSTAGRAM_USER_ID = originalUserId;
  }
});

test('the factory does not fall back from a removed provider selection', () => {
  ProviderFactory.configure({
    providerType: 'serper',
    apiKey: '',
    customEndpoint: ''
  });

  ProviderFactory.configure({
    providerType: 'google_search' as never,
    apiKey: '',
    customEndpoint: ''
  });

  assert.throws(() => ProviderFactory.getProvider(), /Unsupported lead provider/);

  ProviderFactory.configure({
    providerType: 'serper',
    apiKey: '',
    customEndpoint: ''
  });
});
