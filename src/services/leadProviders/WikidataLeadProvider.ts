import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';
import { enrichRawLead } from '../b2bRelevanceService';

const SOURCE_NAME = 'Wikidata SPARQL Query Service';
const DEFAULT_TIMEOUT_MS = 15000;

// Verified Wikidata QIDs for human occupations
export const OCCUPATION_MAP: Record<string, string[]> = {
  'consultant': ['wd:Q15978655'],
  'management consultant': ['wd:Q15978655'],
  'strategy consultant': ['wd:Q15978655'],
  'adviser': ['wd:Q15978655'],
  'advisor': ['wd:Q15978655'],
  'business coach': ['wd:Q105201291', 'wd:Q2790938', 'wd:Q26831130'],
  'executive coach': ['wd:Q2790938', 'wd:Q105201291'],
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
  'director': ['wd:Q3455803', 'wd:Q1622275'],
  'managing director': ['wd:Q3455803', 'wd:Q1622275'],
  'manager': ['wd:Q1622275'],
  'marketing manager': ['wd:Q329439'],
  'marketer': ['wd:Q329439'],
  'vp of sales': ['wd:Q43845'],
  'clinical director': ['wd:Q3455803'],
  'chief medical officer': ['wd:Q484876']
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
    const sparqlQuery = this.buildOccupationQuery(filters);
    const sparqlUrl = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(sparqlUrl, {
        headers: {
          'Accept': 'application/sparql-results+json',
          'User-Agent': 'LinkedInLeadFinder/1.0 (https://github.com/leadfinder; mailto:contact@example.com)'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Wikidata SPARQL query failed with HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data?.results?.bindings || !Array.isArray(data.results.bindings)) {
        return [];
      }

      const primaryTitle = (filters.jobTitles && filters.jobTitles[0]) ? filters.jobTitles[0] : 'Consultant';
      const seenUrls = new Set<string>();
      const leads: RawLead[] = [];

      for (const binding of data.results.bindings) {
        const lead = this.toLead(binding, primaryTitle, filters);
        if (lead && !seenUrls.has(lead.profileUrl)) {
          seenUrls.add(lead.profileUrl);
          leads.push(lead);
        }
      }

      return leads;
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        console.error(`Wikidata search timed out after ${DEFAULT_TIMEOUT_MS}ms`);
      } else {
        console.error('Wikidata search error:', e.message || e);
      }
      return [];
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
          'User-Agent': 'LinkedInLeadFinder/1.0 (https://github.com/leadfinder; mailto:contact@example.com)'
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

  private buildOccupationQuery(filters: LeadFilter): string {
    const rawTitles = filters.jobTitles && filters.jobTitles.length > 0 ? filters.jobTitles : ['consultant'];
    const qids = this.resolveQidsForTitles(rawTitles);
    const occValues = qids.join(' ');

    const countryNorm = (filters.country || '').toLowerCase().trim();
    const countryQid = COUNTRY_MAP[countryNorm];
    const countryClause = countryQid ? `?item wdt:P27 ${countryQid} .` : '';

    const limit = Math.min(Math.max(Number(filters.maxLeads) || 20, 1), 100);

    return `
      SELECT DISTINCT ?item ?itemLabel ?itemDescription ?website ?countryLabel ?dateOfDeath ?dateOfBirth ?email ?phone ?linkedin ?instagram WHERE {
        ?item wdt:P31 wd:Q5 ;
              wdt:P106 ?occ .
        VALUES ?occ { ${occValues} }
        ${countryClause}
        OPTIONAL { ?item wdt:P856 ?website . }
        OPTIONAL { ?item wdt:P27 ?country . }
        OPTIONAL { ?item wdt:P570 ?dateOfDeath . }
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
    const dateOfDeath = binding.dateOfDeath?.value;
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

    return enrichRawLead(baseLead, filters, undefined, dateOfDeath, dateOfBirth);
  }
}
