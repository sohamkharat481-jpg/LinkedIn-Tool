import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const MAX_RESULTS = 500;
const REQUEST_TIMEOUT_MS = 15000;
const MIN_REQUEST_INTERVAL_MS = 10000;
const MAX_DAILY_REQUESTS_PER_INSTANCE = 90;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_REQUEST_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 2000;
const MAX_RETRY_AFTER_MS = 15000;
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

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
    '[out:json][timeout:12][maxsize:67108864];',
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

  private readonly waitForSlot: () => Promise<void>;

  constructor(
    private readonly endpoint = OVERPASS_ENDPOINT,
    private readonly fetcher: typeof fetch = fetch,
    waitForSlot?: () => Promise<void>,
    private readonly delay: (milliseconds: number) => Promise<void> = milliseconds =>
      new Promise(resolve => setTimeout(resolve, milliseconds))
  ) {
    this.waitForSlot = waitForSlot ?? this.waitForRequestSlot.bind(this);
  }

  async search(filters: LeadFilter, queryResultLimit = MAX_RESULTS): Promise<RawLead[]> {
    const query = buildOverpassQuery(filters, queryResultLimit);
    const cached = OverpassLeadProvider.cache.get(query);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.leads.slice(0, normalizeResultLimit(filters.maxLeads));
    }

    let data: OverpassResponse | undefined;
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      await this.waitForSlot();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response | undefined;

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

        if (response.ok) {
          const parsed: unknown = await response.json();
          if (
            parsed === null ||
            typeof parsed !== 'object' ||
            !Array.isArray((parsed as { elements?: unknown }).elements)
          ) {
            throw new OverpassApiError('OpenStreetMap Overpass returned malformed JSON or an invalid response.');
          }
          data = parsed as OverpassResponse;
          break;
        }
      } catch (error) {
        if (error instanceof OverpassApiError) throw error;

        const timedOut = error instanceof Error && error.name === 'AbortError';
        clearTimeout(timeoutId);
        const isMalformedResponse = response?.ok === true;
        if (!timedOut && isMalformedResponse) {
          throw new OverpassApiError('OpenStreetMap Overpass returned malformed JSON or an invalid response.');
        }
        if (attempt === MAX_REQUEST_ATTEMPTS) {
          throw new OverpassApiError(
            timedOut
              ? `OpenStreetMap Overpass request timed out (${REQUEST_TIMEOUT_MS / 1000}s limit).`
              : 'Network error connecting to the public OpenStreetMap Overpass API.'
          );
        }
        await this.delay(this.retryDelay(attempt));
        continue;
      } finally {
        clearTimeout(timeoutId);
      }

      if (response && !response.ok) {
        const canRetry = RETRYABLE_HTTP_STATUSES.has(response.status);
        const retryAfterMs = this.retryAfterDelay(response.headers.get('Retry-After'));
        if (canRetry && attempt < MAX_REQUEST_ATTEMPTS && retryAfterMs <= MAX_RETRY_AFTER_MS) {
          await this.delay(Math.max(this.retryDelay(attempt), retryAfterMs));
          continue;
        }
        throw this.httpError(response.status);
      }
    }

    if (!data) throw new OverpassApiError('OpenStreetMap Overpass returned no response.');
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

  private retryDelay(attempt: number): number {
    return Math.min(INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  }

  private retryAfterDelay(value: string | null): number {
    if (!value) return 0;
    const trimmed = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      return Math.max(0, Math.ceil(Number(trimmed) * 1000));
    }
    const retryAt = Date.parse(trimmed);
    return Number.isNaN(retryAt) ? 0 : Math.max(0, retryAt - Date.now());
  }

  private httpError(status: number): OverpassApiError {
    if (status === 429) {
      return new OverpassApiError(
        'OpenStreetMap Overpass is rate-limiting requests (HTTP 429). Wait before searching again.',
        429
      );
    }
    if (status >= 500) {
      return new OverpassApiError(
        `OpenStreetMap Overpass is temporarily unavailable (HTTP ${status}). Try again later.`,
        status
      );
    }
    return new OverpassApiError(
      `OpenStreetMap Overpass rejected the query (HTTP ${status}).`,
      status
    );
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
