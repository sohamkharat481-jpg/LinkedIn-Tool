import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';
import { diagnoseGooglePlacesFailure, GooglePlacesApiError } from './googlePlacesErrors';

/**
 * Google Maps Platform Places API (New) Lead Provider Adapter
 * Uses the official Text Search endpoint:
 * POST https://places.googleapis.com/v1/places:searchText
 *
 * Grounded in official Google Maps Platform Places API (New) specification.
 * Usage attribution solution ID: gmp_mcp_codeassist_v1_aistudio
 */
export class GoogleMapsPlacesLeadProvider implements LeadProvider {
  readonly providerId = 'google-maps-places-provider';
  readonly providerName = 'Google Maps Platform Places API (New)';
  readonly isMock = false;

  private apiKey: string;
  private endpoint = 'https://places.googleapis.com/v1/places:searchText';

  constructor(apiKey?: string) {
    const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
    this.apiKey =
      apiKey ||
      process.env.GOOGLE_MAPS_API_KEY ||
      (!isProduction ? process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.PLACES_API_KEY : '') ||
      '';
  }

  /**
   * Translates client lead discovery filters into relevant Google Maps Places text queries.
   * e.g. "Technology companies in Mumbai, India"
   */
  generateQueries(filters: LeadFilter): string[] {
    const industries = filters.industry && filters.industry.length > 0 ? filters.industry : [];
    const jobTitles = filters.jobTitles && filters.jobTitles.length > 0 ? filters.jobTitles : [];
    const city = filters.city ? filters.city.trim() : '';
    const country = filters.country ? filters.country.trim() : '';
    const keywords = filters.keywords ? filters.keywords.trim() : '';

    const locationPart = [city, country].filter(Boolean).join(', ');

    const terms: string[] = [];

    if (keywords) {
      terms.push(keywords);
    }

    if (industries.length > 0) {
      for (const ind of industries) {
        if (!terms.includes(ind)) {
          terms.push(ind.includes('companies') || ind.includes('services') || ind.includes('agencies') ? ind : `${ind} companies`);
        }
      }
    }

    if (terms.length === 0 && jobTitles.length > 0) {
      for (const title of jobTitles) {
        terms.push(`${title} businesses`);
      }
    }

    if (terms.length === 0) {
      terms.push('Companies');
    }

    return terms.map(term => (locationPart ? `${term} in ${locationPart}` : term));
  }

  /**
   * Searches for genuine business entities via Google Maps Places API (New) Text Search
   */
  async search(filters: LeadFilter): Promise<RawLead[]> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error(
        'Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY or VITE_GOOGLE_MAPS_API_KEY in environment variables.'
      );
    }

    const targetLimit = Math.min(Math.max(filters.maxLeads || 50, 1), 500);
    const queries = this.generateQueries(filters);
    const allLeads: RawLead[] = [];
    const seenIds = new Set<string>();

    for (const query of queries) {
      if (allLeads.length >= targetLimit) break;

      let nextPageToken: string | undefined = undefined;
      let pageCount = 0;
      const maxPagesPerQuery = 3;

      do {
        pageCount++;
        const pageSize = Math.min(20, targetLimit - allLeads.length);
        const requestBody: any = {
          textQuery: query,
          pageSize
        };
        if (nextPageToken) {
          requestBody.pageToken = nextPageToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        try {
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': this.apiKey,
              'X-Goog-FieldMask':
                'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber,places.nationalPhoneNumber,places.googleMapsUri,places.primaryType,places.primaryTypeDisplayName,places.location,places.rating,places.userRatingCount'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const diagnostics = diagnoseGooglePlacesFailure(await response.text(), response.status, this.apiKey);
            throw new GooglePlacesApiError(
              response.status,
              diagnostics,
              response.status === 403
                ? diagnostics.permissionDiagnosis.action
                : diagnostics.googleError.message
            );
          }

          const data = await response.json();
          const places = Array.isArray(data.places) ? data.places : [];

          for (const place of places) {
            const placeId = place.id || place.displayName?.text || '';
            if (placeId && seenIds.has(placeId)) continue;
            if (placeId) seenIds.add(placeId);

            const businessName = place.displayName?.text || place.displayName || 'Unnamed Business';
            const primaryCategory =
              place.primaryTypeDisplayName?.text ||
              (place.primaryType ? place.primaryType.replace(/_/g, ' ') : '') ||
              filters.industry?.[0] ||
              'Business';

            const rating = place.rating;
            const reviewCount = place.userRatingCount || 0;
            const ratingText = rating ? `${rating}★ (${reviewCount} reviews)` : '';
            const phone = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
            const address =
              place.formattedAddress ||
              (filters.city ? `${filters.city}, ${filters.country}` : filters.country || 'Location Available');
            const profileUrl =
              place.websiteUri ||
              place.googleMapsUri ||
              (place.id ? `https://www.google.com/maps/place/?q=place_id:${place.id}` : 'https://maps.google.com');

            // Headline reflects genuine verified business data from Google Maps
            const headlineParts: string[] = [primaryCategory];
            if (ratingText) headlineParts.push(ratingText);
            if (address) headlineParts.push(address);

            allLeads.push({
              fullName: businessName,
              companyName: businessName,
              currentJobTitle: primaryCategory,
              headline: headlineParts.join(' • '),
              location: address,
              profileUrl,
              connectionsOrFollowers: ratingText || phone || 'Google Maps Verified',
              lastActivityDate: 'N/A',
              source: 'Google Maps Places API (New)'
            });

            if (allLeads.length >= targetLimit) break;
          }

          nextPageToken = data.nextPageToken;
        } catch (err: any) {
          clearTimeout(timeoutId);
          if (err.name === 'AbortError') {
            throw new Error('Google Places API request timed out (12s limit).');
          }
          throw err;
        }
      } while (nextPageToken && allLeads.length < targetLimit && pageCount < maxPagesPerQuery);
    }

    return allLeads;
  }
}
