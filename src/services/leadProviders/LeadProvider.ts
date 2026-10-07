import { LeadFilter, RawLead } from '../../types';

export interface LeadProvider {
  readonly providerId: string;
  readonly providerName: string;
  readonly isMock: boolean;
  
  /**
   * Discovers potential public B2B leads matching given search filters.
   * Only fetches permitted public profile information.
   * NO email addresses, phone numbers, or private credentials.
   */
  search(filters: LeadFilter): Promise<RawLead[]>;
}
