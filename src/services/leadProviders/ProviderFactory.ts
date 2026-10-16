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
    if (currentConfig.providerType === 'serper') {
      const serperKey =
        currentConfig.apiKey ||
        process.env.SERPER_API_KEY ||
        process.env.SERPER_SEARCH_API_KEY ||
        '';
      if (!serperKey) {
        throw new Error('Serper.dev is selected but no API key is configured.');
      }
      return new SerperSearchLeadProvider(serperKey, currentConfig.customEndpoint);
    }

    if (currentConfig.providerType === 'leadocean') {
      const leadOceanKey =
        currentConfig.apiKey ||
        process.env.LEADOCEAN_API_KEY ||
        process.env.LEAD_PROVIDER_API_KEY ||
        '';
      if (!leadOceanKey) {
        throw new Error('LeadOcean is selected but no API key is configured.');
      }
      return new LeadOceanLeadProvider(leadOceanKey, currentConfig.customEndpoint);
    }

    throw new Error(`Unsupported lead provider: ${currentConfig.providerType}`);
  }
}
