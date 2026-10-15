import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const MAX_RESULTS = 500;
const REQUEST_TIMEOUT_MS = 25000;
const MIN_REQUEST_INTERVAL_MS = 10000;
const MAX_DAILY_REQUESTS_PER_INSTANCE = 90;
const CACHE_TTL_MS = 15 * 60 * 1000;

type OsmElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements: OsmElement[];
};

type CachedResult = { expiresAt: number; leads: RawLead[] };

export class OverpassApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'OverpassApiError';
  }
}

const escapeOverpassString = (value: string): string =>
  JSON.stringify(value.trim().replace(/[\u0000-\u001f\u007f]/g, ' '));

const valueForTag = (tags: Record<string, string>, ...keys: string[]): string =>
  keys
    .map(key => (typeof tags[key] === 'string' ? tags[key].trim() : ''))
    .find(Boolean) || '';

const OSM_BUSINESS_TAGS = [
  'shop',
  'office',
  'craft',
  'amenity',
  'tourism',
  'healthcare'
] as const;

const BUSINESS_AMENITIES =
  '^(restaurant|cafe|bar|pub|fast_food|bank|clinic|dentist|doctors|pharmacy|hospital|veterinary|fuel|car_wash|post_office|marketplace|coworking_space)$';
const BUSINESS_TOURISM = '^(hotel|guest_house|hostel|motel|museum|gallery|attraction)$';
const INDUSTRY_ALIASES: Record<string, string[]> = {
  technology: ['computer', 'electronics', 'telecom', 'software', 'it'],
  saas: ['software', 'it', 'computer'],
  healthcare: ['healthcare', 'clinic', 'hospital', 'pharmacy', 'doctors', 'dentist', 'medical'],
  financial: ['bank', 'finance', 'insurance', 'accountant'],
  'real estate': ['estate_agent', 'property'],
  marketing: ['advertising', 'marketing', 'design', 'printing']
};

export function buildOverpassQuery(filters: LeadFilter, limit = MAX_RESULTS): string {
  const city = filters.city?.trim();
  const country = filters.country?.trim();
  if (!city || !country) {
    throw new Error('OpenStreetMap search requires both a city and country to keep the area query bounded.');
  }

  const safeLimit = Math.min(Math.max(Math.floor(limit) || 1, 1), MAX_RESULTS);
  const countryName = escapeOverpassString(country);
  const cityName = escapeOverpassString(city);

  return [
    '[out:json][timeout:20][maxsize:67108864];',
    `area["name"=${countryName}]["boundary"="administrative"]["admin_level"="2"]->.country;`,
    `rel(area.country)["name"=${cityName}]["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10)$"]->.city;`,
    '.city map_to_area -> .searchArea;',
    '(',
    `nwr["name"]["shop"](area.searchArea);`,
    `nwr["name"]["office"](area.searchArea);`,
    `nwr["name"]["craft"](area.searchArea);`,
    `nwr["name"]["amenity"~"${BUSINESS_AMENITIES}"](area.searchArea);`,
    `nwr["name"]["tourism"~"${BUSINESS_TOURISM}"](area.searchArea);`,
    `nwr["name"]["healthcare"](area.searchArea);`,
    ');',
    `out tags center ${safeLimit};`
  ].join('\n');
}

function formatBusinessAddress(tags: Record<string, string>): string {
  const streetAddress = [
    valueForTag(tags, 'addr:housenumber'),
    valueForTag(tags, 'addr:street')
  ]
    .filter(Boolean)
    .join(' ');
  return [
    valueForTag(tags, 'addr:housename'),
    streetAddress,
    valueForTag(tags, 'addr:unit'),
    valueForTag(tags, 'addr:place'),
    valueForTag(tags, 'addr:postcode'),
    valueForTag(tags, 'addr:city'),
    valueForTag(tags, 'addr:country')
  ]
    .filter(Boolean)
    .join(', ');
}

export function mapOsmElementToLead(element: OsmElement): RawLead | null {
  if (
    !element ||
    typeof element !== 'object' ||
    !['node', 'way', 'relation'].includes(element.type) ||
    !Number.isSafeInteger(element.id)
  ) {
    return null;
  }
  const tags = element.tags;
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return null;
  const name = typeof tags.name === 'string' ? tags.name.trim() : '';
  if (!name) return null;

  const categoryKey = OSM_BUSINESS_TAGS.find(
    key => typeof tags[key] === 'string' && tags[key].trim()
  );
  if (!categoryKey) return null;
  const categoryValue = tags[categoryKey];
  if (typeof categoryValue !== 'string' || !categoryValue.trim()) return null;
  const category = `${categoryKey}: ${categoryValue.trim()}`;
  const address = formatBusinessAddress(tags);
  const city = valueForTag(tags, 'addr:city', 'addr:town', 'addr:village');
  const country = valueForTag(tags, 'addr:country');
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  const hasCoordinates =
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude);

  return {
    fullName: name,
    headline: category,
    currentJobTitle: category,
    companyName: name,
    location: address || [city, country].filter(Boolean).join(', '),
    profileUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    connectionsOrFollowers: '',
    lastActivityDate: '',
    source: 'OpenStreetMap (Overpass API)',
    leadType: 'business',
    businessCategory: category,
    businessWebsite: valueForTag(tags, 'website', 'contact:website'),
    businessPhone: valueForTag(tags, 'phone', 'contact:phone'),
    businessAddress: address,
    businessCity: city,
    businessCountry: country,
    ...(hasCoordinates ? { latitude, longitude } : {}),
    osmType: element.type,
    osmId: element.id
  };
}

function matchesBusinessFilters(lead: RawLead, filters: LeadFilter): boolean {
  const requestedTerms = [...(filters.industry || []), filters.keywords || '']
    .map(term => term.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (requestedTerms.length === 0) return true;
  const searchableText = `${lead.companyName} ${lead.businessCategory}`.toLocaleLowerCase();
  return requestedTerms.some(term => {
    if (searchableText.includes(term)) return true;
    const aliases = Object.entries(INDUSTRY_ALIASES).find(([industry]) => term.includes(industry))?.[1] || [];
    return aliases.some(alias => searchableText.includes(alias));
  });
}

export function deduplicateBusinessLeads(leads: RawLead[]): RawLead[] {
  const seenOsmIds = new Set<string>();
  const seenBusinessAddresses = new Set<string>();
  const result: RawLead[] = [];

  for (const lead of leads) {
    if (lead.osmType && lead.osmId !== undefined) {
      const osmIdentifier = `${lead.osmType}/${lead.osmId}`;
      if (seenOsmIds.has(osmIdentifier)) continue;
      seenOsmIds.add(osmIdentifier);
    }

    const address = lead.businessAddress?.trim().toLocaleLowerCase();
    if (address) {
      const businessAddressKey = `${lead.companyName.trim().toLocaleLowerCase()}|${address}`;
      if (seenBusinessAddresses.has(businessAddressKey)) continue;
      seenBusinessAddresses.add(businessAddressKey);
    }
    result.push(lead);
  }

  return result;
}

export class OverpassLeadProvider implements LeadProvider {
  readonly providerId = 'openstreetmap-overpass-provider';
  readonly providerName = 'OpenStreetMap Overpass API';
  readonly isMock = false;

  private static readonly cache = new Map<string, CachedResult>();
  private static requestQueue: Promise<void> = Promise.resolve();
  private static nextRequestAt = 0;
  private static dailyRequestDate = '';
  private static dailyRequestCount = 0;

  constructor(
    private readonly endpoint = OVERPASS_ENDPOINT,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async search(filters: LeadFilter): Promise<RawLead[]> {
    const query = buildOverpassQuery(filters);
    const cached = OverpassLeadProvider.cache.get(query);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.leads.slice(0, normalizeResultLimit(filters.maxLeads));
    }

    await this.waitForRequestSlot();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'LinkedInLeadFinder/1.0 (OpenStreetMap Overpass business search)'
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OverpassApiError('OpenStreetMap Overpass request timed out (25s limit).');
      }
      throw new OverpassApiError('Network error connecting to the public OpenStreetMap Overpass API.');
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new OverpassApiError(
          'OpenStreetMap Overpass is rate-limiting requests (HTTP 429). Wait before searching again.',
          429
        );
      }
      if (response.status >= 500) {
        throw new OverpassApiError(
          `OpenStreetMap Overpass is temporarily unavailable (HTTP ${response.status}). Try again later.`,
          response.status
        );
      }
      throw new OverpassApiError(
        `OpenStreetMap Overpass rejected the query (HTTP ${response.status}).`,
        response.status
      );
    }

    let data: OverpassResponse;
    try {
      const parsed: unknown = await response.json();
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        !Array.isArray((parsed as { elements?: unknown }).elements)
      ) {
        throw new Error('Unexpected response structure');
      }
      data = parsed as OverpassResponse;
    } catch {
      throw new OverpassApiError('OpenStreetMap Overpass returned malformed JSON or an invalid response.');
    }

    const leads = deduplicateBusinessLeads(
      data.elements
        .map(mapOsmElementToLead)
        .filter((lead): lead is RawLead => lead !== null)
        .filter(lead => matchesBusinessFilters(lead, filters))
    );

    OverpassLeadProvider.cache.set(query, { expiresAt: Date.now() + CACHE_TTL_MS, leads });
    if (OverpassLeadProvider.cache.size > 100) {
      const oldestKey = OverpassLeadProvider.cache.keys().next().value;
      if (oldestKey) OverpassLeadProvider.cache.delete(oldestKey);
    }
    return leads.slice(0, normalizeResultLimit(filters.maxLeads));
  }

  private async waitForRequestSlot(): Promise<void> {
    const queuedRequest = OverpassLeadProvider.requestQueue.then(async () => {
      const now = Date.now();
      const today = new Date(now).toISOString().slice(0, 10);
      if (OverpassLeadProvider.dailyRequestDate !== today) {
        OverpassLeadProvider.dailyRequestDate = today;
        OverpassLeadProvider.dailyRequestCount = 0;
      }
      if (OverpassLeadProvider.dailyRequestCount >= MAX_DAILY_REQUESTS_PER_INSTANCE) {
        throw new OverpassApiError(
          'This server instance reached its daily Overpass request safeguard. Try again tomorrow.'
        );
      }

      const waitMs = Math.max(0, OverpassLeadProvider.nextRequestAt - now);
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      OverpassLeadProvider.nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
      OverpassLeadProvider.dailyRequestCount++;
    });
    OverpassLeadProvider.requestQueue = queuedRequest.then(
      () => undefined,
      () => undefined
    );
    await queuedRequest;
  }
}

function normalizeResultLimit(limit: number): number {
  return Math.min(Math.max(Math.floor(limit) || 1, 1), MAX_RESULTS);
}
