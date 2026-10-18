import { LeadProviderConfig } from '../../types';
import { LeadProvider } from './LeadProvider';
import { WikidataLeadProvider } from './WikidataLeadProvider';

let currentConfig: LeadProviderConfig = {
  providerType: 'wikidata',
  apiKey: '',
  customEndpoint: ''
};

export class ProviderFactory {
  static configure(config: Partial<LeadProviderConfig>) {
    currentConfig = { ...currentConfig, ...config };
  }

  static getConfig(): LeadProviderConfig {
    return { ...currentConfig };
  }

  static getProvider(): LeadProvider {
    return new WikidataLeadProvider();
  }
}

