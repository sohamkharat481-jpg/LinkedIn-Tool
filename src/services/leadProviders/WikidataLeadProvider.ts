import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';
import {
  createNetworkRequestDiagnostics,
  createSanitizedNetworkFailure,
  NetworkDiagnosticContext,
  NetworkRequestDiagnostics
} from './networkDiagnostics';

export const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESULTS = 20;
const CAFE_TYPE_QID = 'Q30022';
const CAFE_TERMS = new Set(['cafe', 'cafes', 'café', 'cafés', 'coffee shop', 'coffee shops']);

type SparqlBinding = {
  type?: string;
  value?: string;
};

type SparqlResponse = {
  results?: {
    bindings?: Array<Record<string, SparqlBinding>>;
  };
};

export class WikidataProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    readonly timedOut = false,
    readonly diagnostics?: Partial<NetworkRequestDiagnostics>
  ) {
    super(message);
    this.name = 'WikidataProviderError';
  }
}

const sparqlLiteral = (value: string): string => JSON.stringify(value.trim());

export function buildWikidataCafeQuery(filters: LeadFilter, limit = 10): string {
  const city = filters.city?.trim();
  const country = filters.country?.trim();
  if (!city || !country) {
    throw new Error('Wikidata cafe search requires both a city and country.');
  }

  const requestedTerms = [...(filters.industry || []), filters.keywords || '']
    .flatMap(term => term.toLocaleLowerCase().split(/[,;/]/))
    .map(term => term.trim())
    .filter(Boolean);
  if (requestedTerms.length > 0 && !requestedTerms.every(term => CAFE_TERMS.has(term))) {
    throw new Error('The experimental Wikidata provider currently supports cafe searches only.');
  }

  const safeLimit = Math.min(Math.max(Math.floor(limit) || 1, 1), MAX_RESULTS);
  return `SELECT DISTINCT ?business ?businessLabel ?coord ?website ?phone ?address ?distance WHERE {
  ?city rdfs:label ${sparqlLiteral(city)}@en;
    wdt:P17 ?country;
    wdt:P625 ?center.
  ?country rdfs:label ${sparqlLiteral(country)}@en.
  SERVICE wikibase:around {
    ?business wdt:P625 ?coord.
    bd:serviceParam wikibase:center ?center;
      wikibase:radius "25";
      wikibase:distance ?distance.
  }
  ?business wdt:P31/wdt:P279* wd:${CAFE_TYPE_QID}.
  OPTIONAL { ?business wdt:P856 ?website. }
  OPTIONAL { ?business wdt:P1329 ?phone. }
  OPTIONAL { ?business wdt:P6375 ?address. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?distance
LIMIT ${safeLimit}`;
}

function bindingValue(binding: unknown, key: string): string {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return '';
  const item = (binding as Record<string, unknown>)[key];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  const value = (item as SparqlBinding).value;
  return typeof value === 'string' ? value.trim() : '';
}

export function mapWikidataBindingToLead(
  binding: unknown
): RawLead | null {
  const entity = bindingValue(binding, 'business');
  const idMatch = /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/.exec(entity);
  const name = bindingValue(binding, 'businessLabel');
  if (!idMatch || !name || /^Q[1-9]\d*$/.test(name)) return null;

  const coordinate = bindingValue(binding, 'coord');
  const coordinateMatch = /^Point\((-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\)$/.exec(coordinate);
  const longitude = coordinateMatch ? Number(coordinateMatch[1]) : undefined;
  const latitude = coordinateMatch ? Number(coordinateMatch[2]) : undefined;
  const hasCoordinates =
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;
  const address = bindingValue(binding, 'address');
  const rawWebsite = bindingValue(binding, 'website');
  let website = '';
  try {
    const parsedWebsite = new URL(rawWebsite);
    if (parsedWebsite.protocol === 'http:' || parsedWebsite.protocol === 'https:') {
      website = parsedWebsite.toString();
    }
  } catch {
    website = '';
  }
  const qid = idMatch[1];

  return {
    fullName: name,
    headline: 'Cafe (Wikidata)',
    currentJobTitle: 'Cafe',
    companyName: name,
    location: address,
    profileUrl: `https://www.wikidata.org/entity/${qid}`,
    connectionsOrFollowers: '',
    lastActivityDate: '',
    source: 'Wikidata Query Service',
    leadType: 'business',
    businessCategory: 'cafe',
    businessWebsite: website,
    businessPhone: bindingValue(binding, 'phone'),
    businessAddress: address,
    ...(hasCoordinates ? { latitude, longitude } : {})
  };
}

export class WikidataLeadProvider implements LeadProvider {
  readonly providerId = 'wikidata-cafe-provider';
  readonly providerName = 'Wikidata Query Service (experimental cafes)';
  readonly isMock = false;

  constructor(
    private readonly endpoint = WIKIDATA_ENDPOINT,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS
  ) {}

  async search(
    filters: LeadFilter,
    options: {
      diagnosticContext?: NetworkDiagnosticContext;
      onDiagnostics?: (diagnostics: NetworkRequestDiagnostics) => void;
    } = {}
  ): Promise<RawLead[]> {
    const targetLimit = Math.min(Math.max(Math.floor(filters.maxLeads) || 1, 1), MAX_RESULTS);
    let query: string;
    try {
      query = buildWikidataCafeQuery(filters, targetLimit);
    } catch (error) {
      throw new WikidataProviderError(
        error instanceof Error ? error.message : 'Invalid Wikidata cafe search filters.',
        400
      );
    }
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let diagnostics = createNetworkRequestDiagnostics(
      this.providerId,
      this.endpoint,
      options.diagnosticContext,
      new Date(startedAt),
      startedAt
    );
    diagnostics.failurePhase = 'request';
    const reportDiagnostics = () => {
      diagnostics = { ...diagnostics, elapsedMs: Date.now() - startedAt };
      options.onDiagnostics?.(diagnostics);
    };

    try {
      const response = await Promise.race([
        (async () => {
          const result = await this.fetcher(this.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/sparql-results+json',
              'User-Agent': 'LinkedInLeadFinder/1.0 (public business data discovery)'
            },
            body: new URLSearchParams({ query }).toString(),
            signal: controller.signal
          });
          diagnostics = {
            ...diagnostics,
            responseHeadersReceived: true,
            responseHeadersElapsedMs: Date.now() - startedAt,
            httpStatus: result.status,
            failurePhase: result.ok ? 'response_body' : 'http_status',
            failureOrigin: result.ok ? undefined : 'http_response'
          };
          if (!result.ok) {
            reportDiagnostics();
            throw new WikidataProviderError(
              result.status === 429 || result.status >= 500
                ? `Wikidata Query Service is temporarily unavailable (HTTP ${result.status}).`
                : `Wikidata Query Service rejected the query (HTTP ${result.status}).`,
              result.status,
              false,
              diagnostics
            );
          }

          let parsed: unknown;
          let responseText: string;
          try {
            responseText = await result.text();
          } catch (error) {
            throw new WikidataProviderError(
              'Wikidata Query Service response body could not be read.',
              undefined,
              false,
              {
                ...createSanitizedNetworkFailure(
                  diagnostics,
                  error,
                  'response_error',
                  false,
                  startedAt
                ),
                failurePhase: 'response_body'
              }
            );
          }
          diagnostics = {
            ...diagnostics,
            elapsedMs: Date.now() - startedAt,
            responseBodyCompletedElapsedMs: Date.now() - startedAt,
            failurePhase: 'json_parse'
          };
          try {
            parsed = JSON.parse(responseText);
          } catch {
            throw new WikidataProviderError(
              'Wikidata Query Service returned malformed JSON.',
              undefined,
              false,
              { ...diagnostics, failureOrigin: 'response_error' }
            );
          }
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            !('results' in parsed) ||
            !parsed.results ||
            typeof parsed.results !== 'object' ||
            !('bindings' in parsed.results) ||
            !Array.isArray(parsed.results.bindings)
          ) {
            throw new WikidataProviderError(
              'Wikidata Query Service returned an invalid result shape.',
              undefined,
              false,
              { ...diagnostics, failureOrigin: 'response_error' }
            );
          }
          return (parsed as SparqlResponse).results!.bindings!;
        })(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            diagnostics = {
              ...diagnostics,
              elapsedMs: Date.now() - startedAt,
              timeoutFired: true,
              failureOrigin: 'application_deadline'
            };
            reportDiagnostics();
            reject(
              new WikidataProviderError(
                `Wikidata Query Service request timed out (${this.timeoutMs}ms).`,
                undefined,
                true,
                diagnostics
              )
            );
          }, this.timeoutMs);
        })
      ]);

      const byEntity = new Map<string, RawLead>();
      for (const binding of response) {
        const lead = mapWikidataBindingToLead(binding);
        if (lead && !byEntity.has(lead.profileUrl)) byEntity.set(lead.profileUrl, lead);
      }
      diagnostics = {
        ...diagnostics,
        elapsedMs: Date.now() - startedAt,
        failurePhase: 'result_mapping'
      };
      reportDiagnostics();
      return Array.from(byEntity.values()).slice(0, targetLimit);
    } catch (error) {
      if (error instanceof WikidataProviderError) {
        if (error.diagnostics) diagnostics = { ...diagnostics, ...error.diagnostics };
        if (error.timedOut || error.diagnostics) reportDiagnostics();
        throw error;
      }
      const timedOut = controller.signal.aborted;
      diagnostics = {
        ...diagnostics,
        ...createSanitizedNetworkFailure(
          diagnostics,
          error,
          timedOut ? 'application_deadline' : 'fetch_rejection',
          timedOut,
          startedAt
        )
      };
      reportDiagnostics();
      throw new WikidataProviderError(
        timedOut
          ? `Wikidata Query Service request timed out (${this.timeoutMs}ms).`
          : 'Network error connecting to the Wikidata Query Service.',
        undefined,
        timedOut,
        diagnostics
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
