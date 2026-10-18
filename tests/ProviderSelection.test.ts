import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerLeadProviderService } from '../src/server/leadProviderService';
import { ProviderFactory } from '../src/services/leadProviders/ProviderFactory';

test('the server supports only the Wikidata provider', () => {
  assert.equal(
    ServerLeadProviderService.getStatus().providerName,
    'Wikidata SPARQL Query Service'
  );
});

test('the provider factory creates the Wikidata provider', () => {
  ProviderFactory.configure({
    providerType: 'wikidata',
    apiKey: '',
    customEndpoint: ''
  });

  assert.equal(
    ProviderFactory.getProvider().constructor.name,
    'WikidataLeadProvider'
  );
});

test('provider diagnostics report Wikidata configuration', () => {
    const diagnostics = ServerLeadProviderService.getDiagnostics();
    assert.equal(diagnostics.ActiveProvider, 'Wikidata');
});
