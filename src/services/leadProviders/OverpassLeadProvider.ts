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
const DEFAULT_TOTAL_BUDGET_MS = 60000;

export interface OverpassSearchOptions {
  bypassCache?: boolean;
  maxResults?: number;
  maxAttempts?: number;
  totalBudgetMs?: number;
}

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
    readonly httpStatus?: number,
    readonly diagnostics: {
      attemptCount?: number;
      elapsedMs?: number;
      timeoutReason?: string;
      upstreamHttpStatus?: number;
    } = {}
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

  async search(filters: LeadFilter, options: OverpassSearchOptions = {}): Promise<RawLead[]> {
    const query = buildOverpassQuery(filters, options.maxResults ?? MAX_RESULTS);
    const cached = OverpassLeadProvider.cache.get(query);
    if (!options.bypassCache && cached && cached.expiresAt > Date.now()) {
      return cached.leads.slice(0, normalizeResultLimit(filters.maxLeads));
    }

    const startedAt = Date.now();
    const totalBudgetMs = normalizeBudget(options.totalBudgetMs);
    const deadline = startedAt + totalBudgetMs;
    const maxAttempts = normalizeAttempts(options.maxAttempts);
    let attemptCount = 0;
    let lastUpstreamStatus: number | undefined;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await this.awaitWithinBudget(this.waitForSlot(), deadline);

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw this.totalBudgetError(totalBudgetMs);

        const requestTimeoutMs = Math.min(REQUEST_TIMEOUT_MS, remainingMs);
        const timeoutReason =
          remainingMs <= REQUEST_TIMEOUT_MS
            ? `Total request budget exceeded (${totalBudgetMs}ms).`
            : `Overpass request timed out (${REQUEST_TIMEOUT_MS / 1000}s per-attempt limit).`;
        const controller = new AbortController();
        attemptCount = attempt;
        let response: Response | { response: Response; data: OverpassResponse };
        try {
          response = await this.withRequestTimeout(
            async () => {
              const result = await this.fetcher(this.endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'User-Agent': 'LinkedInLeadFinder/1.0 (OpenStreetMap Overpass business search)'
                },
                body: `data=${encodeURIComponent(query)}`,
                signal: controller.signal
              });
              if (!result.ok) return result;

              const responseText = await result.text();
              if (Date.now() >= deadline) throw this.totalBudgetError(totalBudgetMs);
              let parsed: unknown;
              try {
                parsed = JSON.parse(responseText);
              } catch {
                throw new OverpassApiError(
                  'OpenStreetMap Overpass returned malformed JSON or an invalid response.'
                );
              }
              if (
                parsed === null ||
                typeof parsed !== 'object' ||
                !Array.isArray((parsed as { elements?: unknown }).elements)
              ) {
                throw new OverpassApiError(
                  'OpenStreetMap Overpass returned malformed JSON or an invalid response.'
                );
              }
              if (Date.now() >= deadline) throw this.totalBudgetError(totalBudgetMs);
              return { response: result, data: parsed as OverpassResponse };
            },
            requestTimeoutMs,
            controller,
            timeoutReason
          );
        } catch (error) {
          const timedOut = error instanceof Error && error.name === 'AbortError';
          const requestError = error instanceof OverpassApiError
            ? error
            : timedOut
            ? new OverpassApiError(timeoutReason, undefined, { timeoutReason })
            : new OverpassApiError(
                'Network error connecting to the public OpenStreetMap Overpass API.'
              );
          const canRetryTimeout =
            requestError instanceof OverpassApiError &&
            requestError.diagnostics.timeoutReason?.startsWith('Overpass request timed out') &&
            attempt < maxAttempts;
          const canRetryNetwork =
            requestError.message === 'Network error connecting to the public OpenStreetMap Overpass API.' &&
            attempt < maxAttempts;
          if (!canRetryTimeout && !canRetryNetwork) throw requestError;
          await this.awaitWithinBudget(
            this.delay(this.retryDelay(attempt)),
            deadline,
            `Total request budget exceeded (${totalBudgetMs}ms) while waiting to retry.`
          );
          continue;
        }

        if ('data' in response) {
          const leads = deduplicateBusinessLeads(
            response.data.elements
              .map(mapOsmElementToLead)
              .filter((lead): lead is RawLead => lead !== null)
              .filter(lead => matchesBusinessFilters(lead, filters))
          );
          if (Date.now() >= deadline) throw this.totalBudgetError(totalBudgetMs);

          OverpassLeadProvider.cache.set(query, { expiresAt: Date.now() + CACHE_TTL_MS, leads });
          if (OverpassLeadProvider.cache.size > 100) {
            const oldestKey = OverpassLeadProvider.cache.keys().next().value;
            if (oldestKey) OverpassLeadProvider.cache.delete(oldestKey);
          }
          return leads.slice(0, normalizeResultLimit(filters.maxLeads));
        }

        lastUpstreamStatus = response.status;
        const canRetry =
          RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < maxAttempts;
        if (!canRetry) throw this.httpError(response.status);

        const retryAfterMs = this.retryAfterDelay(response.headers.get('Retry-After'));
        if (retryAfterMs > MAX_RETRY_AFTER_MS) throw this.httpError(response.status);
        const waitMs = Math.max(this.retryDelay(attempt), retryAfterMs);
        await this.awaitWithinBudget(
          this.delay(waitMs),
          deadline,
          `Total request budget exceeded (${totalBudgetMs}ms) while waiting to retry.`
        );
      }
      throw new OverpassApiError('OpenStreetMap Overpass returned no response.');
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const failure =
        error instanceof OverpassApiError
          ? error
          : new OverpassApiError('Network error connecting to the public OpenStreetMap Overpass API.');
      throw new OverpassApiError(failure.message, failure.httpStatus, {
        attemptCount,
        elapsedMs,
        timeoutReason: failure.diagnostics.timeoutReason,
        upstreamHttpStatus: lastUpstreamStatus
      });
    }
  }

  private async withRequestTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    controller: AbortController,
    timeoutReason: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new OverpassApiError(timeoutReason, undefined, { timeoutReason }));
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation(), timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async awaitWithinBudget<T>(
    operation: Promise<T>,
    deadline: number,
    message?: string
  ): Promise<T> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw this.totalBudgetError(message);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(this.totalBudgetError(message)),
        remainingMs
      );
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private totalBudgetError(message?: string | number): OverpassApiError {
    const reason =
      typeof message === 'number'
        ? `Total request budget exceeded (${message}ms).`
        : message || 'Total request time budget exceeded.';
    return new OverpassApiError(reason, undefined, { timeoutReason: reason });
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

function normalizeBudget(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TOTAL_BUDGET_MS;
  return Math.min(Math.max(Math.floor(value), 1), 120000);
}

function normalizeAttempts(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return MAX_REQUEST_ATTEMPTS;
  return Math.min(Math.max(Math.floor(value), 1), MAX_REQUEST_ATTEMPTS);
}

function normalizeResultLimit(limit: number): number {
  return Math.min(Math.max(Math.floor(limit) || 1, 1), MAX_RESULTS);
}
