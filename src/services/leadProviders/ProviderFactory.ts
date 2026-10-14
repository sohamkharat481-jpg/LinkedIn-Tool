import { LeadProviderConfig } from '../../types';
import { LeadProvider } from './LeadProvider';
import { LeadOceanLeadProvider } from './LeadOceanLeadProvider';
import { SerperSearchLeadProvider } from './SerperSearchLeadProvider';

let currentConfig: LeadProviderConfig = {
  providerType: 'serper',
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
    const serperKey =
      process.env.SERPER_API_KEY ||
      process.env.SERPER_SEARCH_API_KEY ||
      (currentConfig.providerType === 'serper' ? currentConfig.apiKey : '');

    const leadOceanKey =
      process.env.LEADOCEAN_API_KEY ||
      (currentConfig.providerType === 'leadocean' ? currentConfig.apiKey : '') ||
      process.env.LEAD_PROVIDER_API_KEY;

    // Prefer Serper if configured or explicitly selected
    if (currentConfig.providerType === 'serper' && serperKey) {
      return new SerperSearchLeadProvider(serperKey, currentConfig.customEndpoint);
    }

    if (currentConfig.providerType === 'leadocean' && leadOceanKey) {
      return new LeadOceanLeadProvider(leadOceanKey, currentConfig.customEndpoint);
    }

    if (serperKey) {
      return new SerperSearchLeadProvider(serperKey, currentConfig.customEndpoint);
    }

    if (leadOceanKey) {
      return new LeadOceanLeadProvider(leadOceanKey, currentConfig.customEndpoint);
    }

    throw new Error('Serper.dev public-web lead provider is not connected. Missing SERPER_API_KEY.');
  }
}
