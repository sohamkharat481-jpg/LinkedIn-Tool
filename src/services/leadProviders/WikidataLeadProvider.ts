import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';
import { enrichRawLead } from '../b2bRelevanceService';

const SOURCE_NAME = 'Wikidata SPARQL Query Service';
const PRIMARY_TIMEOUT_MS = 14000;
const FALLBACK_TIMEOUT_MS = 10000;
const USER_AGENT = 'LinkedInLeadFinder/1.0 (https://github.com/sohamkharat481-jpg/LinkedIn-Tool; contact@example.com)';

// Verified Wikidata QIDs for human occupations and leadership positions
export const OCCUPATION_MAP: Record<string, string[]> = {
  'consultant': ['wd:Q15978655'],
  'management consultant': ['wd:Q15978655'],
  'strategy consultant': ['wd:Q15978655'],
  'adviser': ['wd:Q15978655'],
  'advisor': ['wd:Q15978655'],
  'business coach': ['wd:Q105201291', 'wd:Q2790938', 'wd:Q26831130'],
  'executive coach': ['wd:Q105201291', 'wd:Q2790938', 'wd:Q26831130'],
  'coach': ['wd:Q105201291', 'wd:Q2790938', 'wd:Q26831130'],
  'life coach': ['wd:Q26831130'],
  'entrepreneur': ['wd:Q131524', 'wd:Q43845'],
  'founder': ['wd:Q4479442', 'wd:Q131524'],
  'company founder': ['wd:Q4479442', 'wd:Q131524'],
  'co-founder': ['wd:Q4479442', 'wd:Q131524'],
  'business owner': ['wd:Q131524', 'wd:Q43845'],
  'businessperson': ['wd:Q43845'],
  'ceo': ['wd:Q484876', 'wd:Q43845'],
  'chief executive officer': ['wd:Q484876', 'wd:Q43845'],
  'c-level': ['wd:Q484876', 'wd:Q43845', 'wd:Q1162163', 'wd:Q3455803'],
  'c-suite': ['wd:Q484876', 'wd:Q43845', 'wd:Q1162163', 'wd:Q3455803'],
  'executive': ['wd:Q484876', 'wd:Q43845', 'wd:Q1162163', 'wd:Q3455803'],
  'director': ['wd:Q1162163', 'wd:Q19940089', 'wd:Q3455803', 'wd:Q1622275'],
  'managing director': ['wd:Q19940089', 'wd:Q1162163', 'wd:Q3455803', 'wd:Q1622275'],
  'vp': ['wd:Q42178', 'wd:Q43845', 'wd:Q3455803'],
  'vp of sales': ['wd:Q64155861', 'wd:Q42178', 'wd:Q43845', 'wd:Q3455803'],
  'vice president': ['wd:Q42178', 'wd:Q43845', 'wd:Q3455803'],
  'manager': ['wd:Q2462658', 'wd:Q1622275'],
  'marketing manager': ['wd:Q88206817', 'wd:Q329439', 'wd:Q1622275'],
  'marketer': ['wd:Q88206817', 'wd:Q329439'],
  'clinical director': ['wd:Q1162163', 'wd:Q3455803'],
  'chief medical officer': ['wd:Q484876', 'wd:Q1162163', 'wd:Q3455803'],
  'senior': ['wd:Q1162163', 'wd:Q3455803', 'wd:Q1622275', 'wd:Q43845']
};

export const COUNTRY_MAP: Record<string, string> = {
  'united states': 'wd:Q30',
  'usa': 'wd:Q30',
  'us': 'wd:Q30',
  'united kingdom': 'wd:Q145',
  'uk': 'wd:Q145',
  'great britain': 'wd:Q145',
  'canada': 'wd:Q16',
  'germany': 'wd:Q183',
  'france': 'wd:Q142',
  'australia': 'wd:Q408',
  'india': 'wd:Q668',
  'singapore': 'wd:Q334',
  'united arab emirates': 'wd:Q878',
  'uae': 'wd:Q878',
  'brazil': 'wd:Q155',
  'netherlands': 'wd:Q55',
  'switzerland': 'wd:Q39',
  'spain': 'wd:Q29',
  'italy': 'wd:Q38',
  'japan': 'wd:Q17'
};

export class WikidataLeadProvider implements LeadProvider {
  readonly providerId = 'wikidata-b2b-provider';
  readonly providerName = 'Wikidata SPARQL Query Service';
  readonly isMock = false;

  async search(filters: LeadFilter): Promise<RawLead[]> {
    const primaryTitle = (filters.jobTitles && filters.jobTitles[0]) ? filters.jobTitles[0] : 'Consultant';

    // Attempt 1: Optimized primary query with subselect pattern
    try {
      const primaryQuery = this.buildOccupationQuery(filters, false);
      const leads = await this.executeSparqlQuery(primaryQuery, PRIMARY_TIMEOUT_MS, filters, primaryTitle, 1);
      if (leads.length > 0) {
        return leads;
      }
      console.warn('[Diagnostic] Wikidata primary query returned 0 leads. Attempting streamlined executive fallback...');
    } catch (primaryErr: any) {
      const isRetryable = primaryErr.isRetryable || primaryErr.name === 'AbortError' || primaryErr.status === 429 || (primaryErr.status >= 500 && primaryErr.status <= 504);
      if (!isRetryable) {
        throw primaryErr;
      }

      const retryAfterMs = primaryErr.retryAfterMs || 1500;
      console.warn(`[Diagnostic] Wikidata primary query failed (${primaryErr.message}). Waiting ${retryAfterMs}ms before fallback attempt...`);
      await new Promise(resolve => setTimeout(resolve, retryAfterMs));
    }

    // Attempt 2: Streamlined executive query with controlled backoff
    try {
      const fallbackQuery = this.buildOccupationQuery(filters, true);
      const fallbackLeads = await this.executeSparqlQuery(fallbackQuery, FALLBACK_TIMEOUT_MS, filters, primaryTitle, 2);
      return fallbackLeads;
    } catch (fallbackErr: any) {
      if (fallbackErr.name === 'AbortError') {
        throw new Error('Wikidata SPARQL query service timed out after retry. Please try again or narrow your search filters.');
      }
      throw fallbackErr;
    }
  }

  private async executeSparqlQuery(
    sparqlQuery: string,
    timeoutMs: number,
    filters: LeadFilter,
    primaryTitle: string,
    attempt: number
  ): Promise<RawLead[]> {
    const sparqlUrl = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    try {
      const response = await fetch(sparqlUrl, {
        headers: {
          'Accept': 'application/sparql-results+json',
          'User-Agent': USER_AGENT
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const retryAfterHeader = response.headers.get('Retry-After');
        let retryAfterMs = 1500;
        if (retryAfterHeader) {
          const parsedSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSeconds) && parsedSeconds > 0 && parsedSeconds <= 5) {
            retryAfterMs = parsedSeconds * 1000;
          }
        }

        const err: any = new Error(`Wikidata SPARQL query failed with HTTP ${response.status}`);
        err.status = response.status;
        err.retryAfterMs = retryAfterMs;
        err.isRetryable = response.status === 429 || (response.status >= 500 && response.status <= 504);
        console.error(`[Diagnostic] Wikidata HTTP Error ${response.status} in ${durationMs}ms (Attempt ${attempt})`);
        throw err;
      }

      const data = await response.json();
      const rawResultsCount = Array.isArray(data?.results?.bindings) ? data.results.bindings.length : 0;

      if (!data?.results?.bindings || !Array.isArray(data.results.bindings)) {
        console.warn(`[Diagnostic] Wikidata Search HTTP 200 in ${durationMs}ms (Attempt ${attempt}) | Raw bindings: 0 | Mapped unique leads: 0`);
        return [];
      }

      const seenUrls = new Set<string>();
      const leads: RawLead[] = [];

      for (const binding of data.results.bindings) {
        const lead = this.toLead(binding, primaryTitle, filters);
        if (lead && !seenUrls.has(lead.profileUrl)) {
          seenUrls.add(lead.profileUrl);
          leads.push(lead);
        }
      }

      console.log(`[Diagnostic] Wikidata Search HTTP ${response.status} in ${durationMs}ms (Attempt ${attempt}) | Raw bindings: ${rawResultsCount} | Mapped unique leads: ${leads.length}`);
      return leads;
    } catch (e: any) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;
      if (e.name === 'AbortError') {
        console.error(`[Diagnostic] Wikidata Search Timeout after ${elapsedMs}ms (Attempt ${attempt}, Limit: ${timeoutMs}ms)`);
        const abortErr: any = new Error(`Wikidata SPARQL query service timed out after ${Math.round(elapsedMs / 1000)}s.`);
        abortErr.name = 'AbortError';
        abortErr.isRetryable = true;
        throw abortErr;
      }
      console.error(`[Diagnostic] Wikidata Search Error after ${elapsedMs}ms (Attempt ${attempt}):`, e.message || e);
      throw e;
    }
  }

  async testConnection(): Promise<void> {
    const query = 'SELECT ?item WHERE { ?item wdt:P31 wd:Q5 . } LIMIT 1';
    const sparqlUrl = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(sparqlUrl, {
        headers: {
          'Accept': 'application/sparql-results+json',
          'User-Agent': USER_AGENT
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`Wikidata connection test failed with HTTP ${response.status}`);
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw new Error(err.name === 'AbortError' ? 'Wikidata connection test timed out.' : err.message);
    }
  }

  public resolveQidsForTitles(titles: string[]): string[] {
    const qidSet = new Set<string>();

    for (const raw of titles) {
      const norm = raw.toLowerCase().trim();
      const exactMatch = OCCUPATION_MAP[norm];
      if (exactMatch && exactMatch.length > 0) {
        exactMatch.forEach(q => qidSet.add(q));
        continue;
      }

      // Check partial keyword matching
      let matched = false;
      for (const [key, qids] of Object.entries(OCCUPATION_MAP)) {
        if (norm.includes(key) || key.includes(norm)) {
          qids.forEach(q => qidSet.add(q));
          matched = true;
        }
      }

      // Safe fallback for unmapped professional terms
      if (!matched) {
        qidSet.add('wd:Q15978655'); // Consultant
        qidSet.add('wd:Q43845');    // Businessperson
      }
    }

    return Array.from(qidSet);
  }

  public buildOccupationQuery(filters: LeadFilter, isFallback = false): string {
    let occValues: string;
    if (isFallback) {
      // High-yield, fast-executing business executive QIDs
      occValues = 'wd:Q4479442 wd:Q484876 wd:Q131524 wd:Q43845';
    } else {
      const rawTitles = filters.jobTitles && filters.jobTitles.length > 0 ? filters.jobTitles : ['consultant'];
      const titleCandidates = [...rawTitles];
      if (filters.seniority && filters.seniority.length > 0) {
        filters.seniority.forEach(s => titleCandidates.push(s));
      }
      const qids = this.resolveQidsForTitles(titleCandidates);
      occValues = qids.join(' ');
    }

    const countryNorm = (filters.country || '').toLowerCase().trim();
    const countryQid = COUNTRY_MAP[countryNorm];
    const countryClause = countryQid ? `?item wdt:P27 ${countryQid} .` : '';

    const limit = Math.min(Math.max(Number(filters.maxLeads) || 20, 1), 100);
    const innerLimit = Math.min(Math.max(limit * 2, limit + 25), 150);

    return `
      SELECT DISTINCT ?item ?itemLabel ?itemDescription ?website ?countryLabel ?dateOfBirth ?email ?phone ?linkedin ?instagram WHERE {
        {
          SELECT DISTINCT ?item WHERE {
            ?item wdt:P106 ?occ .
            VALUES ?occ { ${occValues} }
            ${countryClause}
            ?item wdt:P31 wd:Q5 .
          }
          LIMIT ${innerLimit}
        }
        OPTIONAL { ?item wdt:P570 ?deathDate . }
        FILTER(!BOUND(?deathDate))
        OPTIONAL { ?item wdt:P856 ?website . }
        OPTIONAL { ?item wdt:P27 ?country . }
        OPTIONAL { ?item wdt:P569 ?dateOfBirth . }
        OPTIONAL { ?item wdt:P968 ?email . }
        OPTIONAL { ?item wdt:P1329 ?phone . }
        OPTIONAL { ?item wdt:P6634 ?linkedin . }
        OPTIONAL { ?item wdt:P2003 ?instagram . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en,en-US,en-GB". }
      }
      LIMIT ${limit}
    `;
  }

  private toLead(binding: any, requestedTitle: string, filters: LeadFilter): RawLead | null {
    if (!binding.item || !binding.itemLabel || !binding.itemLabel.value) return null;
    
    // Ignore internal placeholder IDs if label missing
    const label = binding.itemLabel.value.trim();
    if (!label || /^Q\d+$/.test(label)) return null;

    // Filter out deceased individuals if any slipped past SPARQL filter
    if (binding.deathDate && binding.deathDate.value) {
      return null;
    }

    const description = binding.itemDescription?.value || '';
    const rawWebsite = binding.website?.value ? binding.website.value.trim() : undefined;
    const website = rawWebsite && /^https?:\/\//i.test(rawWebsite)
      ? rawWebsite.replace(/^https?:\/\//i, (m: string) => m.toLowerCase())
      : undefined;
    
    const rawEmail = binding.email?.value ? binding.email.value.replace(/^mailto:/i, '').trim() : undefined;
    const email = rawEmail && rawEmail.includes('@') ? rawEmail : undefined;

    const rawPhone = binding.phone?.value ? binding.phone.value.trim() : undefined;
    const phone = rawPhone && rawPhone.length >= 5 ? rawPhone : undefined;

    const rawLinkedin = binding.linkedin?.value ? binding.linkedin.value.trim() : undefined;
    const linkedInProfileUrl = rawLinkedin ? (rawLinkedin.startsWith('http') ? rawLinkedin : `https://www.linkedin.com/in/${rawLinkedin}`) : undefined;

    const rawInstagram = binding.instagram?.value ? binding.instagram.value.trim().replace(/^@/, '') : undefined;
    const instagramUsername = rawInstagram && /^[a-zA-Z0-9._]{1,30}$/.test(rawInstagram) ? rawInstagram : undefined;
    const instagramProfileUrl = instagramUsername ? `https://www.instagram.com/${instagramUsername}/` : undefined;
    const instagramDiscoverySource = instagramUsername ? 'Wikidata (P2003)' : undefined;
    const instagramVerificationStatus = instagramUsername ? 'Verified' : undefined;
    const instagramVerificationEvidence = instagramUsername ? `Official Wikidata statement (P2003) verified for ${label}` : undefined;
    const instagramLastCheckedAt = instagramUsername ? new Date().toISOString() : undefined;

    const country = binding.countryLabel?.value ? binding.countryLabel.value.trim() : 'N/A';
    const dateOfBirth = binding.dateOfBirth?.value;

    const hasContact = Boolean(website || email || phone || linkedInProfileUrl || instagramUsername);
    const contactVerificationStatus = hasContact ? 'Available' : 'Not listed';

    const baseLead: RawLead = {
      fullName: label,
      headline: description || `Professional ${requestedTitle}`,
      currentJobTitle: requestedTitle,
      companyName: description.toLowerCase().includes('founder') ? 'Founder / Self-Employed' : 'Independent / Public Entity',
      location: country,
      profileUrl: binding.item.value,
      connectionsOrFollowers: 'N/A',
      lastActivityDate: 'N/A',
      source: SOURCE_NAME,
      businessWebsite: website,
      businessEmail: email,
      businessPhone: phone,
      linkedInProfileUrl: linkedInProfileUrl,
      contactSource: SOURCE_NAME,
      contactVerificationStatus,
      instagramUsername,
      instagramProfileUrl,
      instagramVerificationStatus,
      instagramVerificationEvidence,
      instagramDiscoverySource,
      instagramLastCheckedAt
    };

    return enrichRawLead(baseLead, filters, undefined, undefined, dateOfBirth);
  }
}
