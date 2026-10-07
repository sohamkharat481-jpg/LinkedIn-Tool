import { LeadProviderConfig } from '../../types';
import { LeadProvider } from './LeadProvider';
import { MockLeadProvider } from './MockLeadProvider';
import { GoogleSearchLeadProvider } from './GoogleSearchLeadProvider';
import { ApolloLeadProvider } from './ApolloLeadProvider';
import { SerpApiLeadProvider } from './SerpApiLeadProvider';
import { RealApiLeadProvider } from './RealApiLeadProvider';

let currentConfig: LeadProviderConfig = {
  providerType: 'mock',
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
    const googleKey = process.env.GOOGLE_SEARCH_API_KEY || currentConfig.apiKey;
    const googleCx = process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (currentConfig.providerType === 'google_search' || (googleKey && googleCx)) {
      return new GoogleSearchLeadProvider(googleKey, googleCx);
    }

    const activeKey = currentConfig.apiKey || process.env.LEAD_PROVIDER_API_KEY || process.env.APOLLO_API_KEY;

    if (currentConfig.providerType === 'rapidapi' || currentConfig.providerType === 'custom_proxy') {
      if (currentConfig.customEndpoint && currentConfig.customEndpoint.includes('serpapi')) {
        return new SerpApiLeadProvider(activeKey);
      }
      if (activeKey) {
        return new ApolloLeadProvider(activeKey, currentConfig.customEndpoint);
      }
      return new RealApiLeadProvider(activeKey || '', currentConfig.customEndpoint);
    }
    
    // Default fallback to Mock Lead Provider
    return new MockLeadProvider();
  }
}
