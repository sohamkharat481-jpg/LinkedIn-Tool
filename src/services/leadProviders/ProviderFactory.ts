import { LeadProviderConfig } from '../../types';
import { LeadProvider } from './LeadProvider';
import { GoogleMapsPlacesLeadProvider } from './GoogleMapsPlacesLeadProvider';
import { LeadOceanLeadProvider } from './LeadOceanLeadProvider';
import { SerperSearchLeadProvider } from './SerperSearchLeadProvider';

let currentConfig: LeadProviderConfig = {
  providerType: 'google_places',
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
    const googleMapsKey =
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.PLACES_API_KEY ||
      (currentConfig.providerType === 'google_places' ? currentConfig.apiKey : '');

    const serperKey =
      process.env.SERPER_API_KEY ||
      process.env.SERPER_SEARCH_API_KEY ||
      (currentConfig.providerType === 'serper' ? currentConfig.apiKey : '');

    const leadOceanKey =
      process.env.LEADOCEAN_API_KEY ||
      (currentConfig.providerType === 'leadocean' ? currentConfig.apiKey : '') ||
      process.env.LEAD_PROVIDER_API_KEY;

    // Prefer Google Maps Platform Places API (New) as primary
    if ((currentConfig.providerType === 'google_places' || !currentConfig.providerType) && googleMapsKey) {
      return new GoogleMapsPlacesLeadProvider(googleMapsKey);
    }

    if (currentConfig.providerType === 'serper' && serperKey) {
      return new SerperSearchLeadProvider(serperKey, currentConfig.customEndpoint);
    }

    if (currentConfig.providerType === 'leadocean' && leadOceanKey) {
      return new LeadOceanLeadProvider(leadOceanKey, currentConfig.customEndpoint);
    }

    if (googleMapsKey) {
      return new GoogleMapsPlacesLeadProvider(googleMapsKey);
    }

    if (serperKey) {
      return new SerperSearchLeadProvider(serperKey, currentConfig.customEndpoint);
    }

    if (leadOceanKey) {
      return new LeadOceanLeadProvider(leadOceanKey, currentConfig.customEndpoint);
    }

    throw new Error('Google Maps Platform Places API is not configured. Missing GOOGLE_MAPS_API_KEY.');
  }
}
