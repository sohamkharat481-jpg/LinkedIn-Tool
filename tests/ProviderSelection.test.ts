import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerLeadProviderService } from '../src/server/leadProviderService';
import { ProviderFactory } from '../src/services/leadProviders/ProviderFactory';

test('the server supports only the remaining explicit providers', () => {
  assert.equal(ServerLeadProviderService.resolveApiKey(undefined, 'serper').type, 'serper');
  assert.equal(ServerLeadProviderService.resolveApiKey(undefined, 'leadocean').type, 'leadocean');

  for (const removedProvider of ['google_search', 'google_places', 'overpass', 'wikidata']) {
    assert.throws(
      () => ServerLeadProviderService.resolveApiKey(undefined, removedProvider),
      /Unsupported lead provider/
    );
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
