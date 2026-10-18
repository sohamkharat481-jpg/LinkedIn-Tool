import {
  RawLead,
  LeadRecord,
  LeadFilter,
  B2BLeadClassification,
  EntityPeriod,
  RelevanceBreakdown
} from '../types';

export interface HistoricalDetectionResult {
  isDeceased: boolean;
  dateOfDeath?: string;
  dateOfBirth?: string;
  entityPeriod: EntityPeriod;
  reason: string;
}

export interface RelevanceCalculationResult {
  score: number;
  breakdown: RelevanceBreakdown;
  explanation: string;
  classification: B2BLeadClassification;
  activeEvidence?: string;
}

/**
 * Extracts and analyzes Wikidata life dates and historical indicators.
 * Reliable Wikidata properties:
 * - P570: Date of death
 * - P569: Date of birth
 * - Textual lifetime patterns like (1887-1973) or explicit words.
 *
 * NOTE: Current activity is NEVER inferred solely from a person's age or birth date.
 */
export function detectHistoricalStatus(
  dateOfDeath?: string,
  dateOfBirth?: string,
  description: string = '',
  headline: string = ''
): HistoricalDetectionResult {
  const combinedText = `${description} ${headline}`.trim();

  // 1. Check explicit date of death (Wikidata P570)
  if (dateOfDeath && dateOfDeath.trim().length > 0) {
    const yearMatch = dateOfDeath.match(/^([+-]?\d{1,4})/);
    const deathYear = yearMatch ? yearMatch[1].replace('+', '') : dateOfDeath.substring(0, 4);
    return {
      isDeceased: true,
      dateOfDeath: deathYear,
      dateOfBirth: dateOfBirth ? dateOfBirth.substring(0, 4).replace('+', '') : undefined,
      entityPeriod: 'deceased',
      reason: `Documented date of death on Wikidata (${deathYear})`
    };
  }

  // 2. Check description patterns for lifetime year ranges e.g. (1887-1973), (1920–2005)
  const lifetimeRegex = /\((\d{3,4})[\s–\-]+(\d{3,4})\)/;
  const match = combinedText.match(lifetimeRegex);
  if (match) {
    const birthYear = parseInt(match[1], 10);
    const deathYear = parseInt(match[2], 10);
    const currentYear = new Date().getFullYear();
    if (deathYear <= currentYear) {
      return {
        isDeceased: true,
        dateOfDeath: String(deathYear),
        dateOfBirth: String(birthYear),
        entityPeriod: 'deceased',
        reason: `Documented lifetime years in public description (${birthYear}–${deathYear})`
      };
    }
  }

  // 3. Check keywords for deceased
  if (/\b(died|deceased|late entrepreneur|late founder)\b/i.test(combinedText)) {
    return {
      isDeceased: true,
      entityPeriod: 'deceased',
      reason: 'Described as deceased in public record'
    };
  }

  // 4. Check historical era based on birth date (e.g. born before 1925 = over 100 years ago)
  if (dateOfBirth) {
    const yearMatch = dateOfBirth.match(/^([+-]?\d{1,4})/);
    const birthYear = yearMatch ? parseInt(yearMatch[1].replace('+', ''), 10) : NaN;
    if (!isNaN(birthYear)) {
      if (birthYear < 1925) {
        return {
          isDeceased: false,
          dateOfBirth: String(birthYear),
          entityPeriod: 'historical',
          reason: `Historical era entity born in ${birthYear}`
        };
      }
      return {
        isDeceased: false,
        dateOfBirth: String(birthYear),
        entityPeriod: 'modern',
        reason: `Modern era individual (born ${birthYear})`
      };
    }
  }

  // 5. Check historical keywords in description
  if (/\b(18th-century|19th-century|ancient|historical figure)\b/i.test(combinedText)) {
    return {
      isDeceased: false,
      entityPeriod: 'historical',
      reason: 'Entity described as historical figure in public record'
    };
  }

  // Default: modern contemporary entity
  return {
    isDeceased: false,
    entityPeriod: 'modern',
    reason: 'Contemporary public record with no death date recorded'
  };
}

/**
 * Calculates a transparent, evidence-based relevance score (0-100)
 * based on available data without treating missing data as negative proof.
 */
export function calculateRelevanceScore(
  lead: {
    fullName: string;
    headline: string;
    currentJobTitle: string;
    businessWebsite?: string;
    isDeceased?: boolean;
    entityPeriod?: EntityPeriod;
  },
  filters: LeadFilter,
  clientNiche?: string
): RelevanceCalculationResult {
  const details: string[] = [];

  // --- 1. OCCUPATION MATCH (Max 35 points) ---
  let occupationPoints = 0;
  let occupationMatch = false;

  const searchTitles = (filters.jobTitles || []).map((t) => t.toLowerCase().trim()).filter(Boolean);
  const headlineLower = (lead.headline || '').toLowerCase();
  const currentTitleLower = (lead.currentJobTitle || '').toLowerCase();

  let matchedTitle = '';
  for (const st of searchTitles) {
    if (headlineLower.includes(st) || currentTitleLower.includes(st)) {
      matchedTitle = st;
      break;
    }
  }

  if (matchedTitle) {
    occupationPoints = 35;
    occupationMatch = true;
    details.push(`Occupation (+35): Documented role matches requested title '${matchedTitle}'`);
  } else {
    // Check known broad business roles only if search requested a related business category
    const broadMatches = ['consultant', 'coach', 'entrepreneur', 'founder', 'business', 'director', 'manager', 'ceo'];
    const searchHasBroad = searchTitles.some((st) => broadMatches.some((bm) => st.includes(bm)));
    const matchedBroad = broadMatches.find((bm) => headlineLower.includes(bm) || currentTitleLower.includes(bm));

    if (searchHasBroad && matchedBroad) {
      occupationPoints = 25;
      occupationMatch = true;
      details.push(`Occupation (+25): Documented role matches related category '${matchedBroad}'`);
    } else {
      occupationPoints = 10;
      occupationMatch = false;
      details.push('Occupation (+10): Documented role does not directly match requested titles');
    }
  }

  // --- 2. NICHE / INDUSTRY MATCH (Max 25 points) ---
  let nichePoints = 0;
  let nicheMatch = false;

  const targetNiches: string[] = [];
  if (clientNiche && clientNiche.trim()) targetNiches.push(clientNiche.toLowerCase().trim());
  if (filters.industry && filters.industry.length > 0) {
    filters.industry.forEach((ind) => targetNiches.push(ind.toLowerCase().trim()));
  }

  if (targetNiches.length > 0) {
    const matchedNiche = targetNiches.find((niche) => {
      // Split into keywords
      const terms = niche.split(/[\s,&/]+/).filter((t) => t.length > 2);
      return terms.some((term) => headlineLower.includes(term));
    });

    if (matchedNiche) {
      nichePoints = 25;
      nicheMatch = true;
      details.push(`Niche (+25): Documented background matches '${matchedNiche}'`);
    } else {
      nichePoints = 0;
      nicheMatch = false;
      details.push('Niche (+0): No explicit niche keywords documented (missing data not penalized)');
    }
  } else {
    // Neutral points when no niche constraint requested
    nichePoints = 20;
    nicheMatch = true;
    details.push('Niche (+20 neutral): No specific industry or niche filter requested');
  }

  // --- 3. OFFICIAL WEBSITE AVAILABILITY (Max 25 points) ---
  let websitePoints = 0;
  let websiteAvailable = false;

  if (lead.businessWebsite && /^https?:\/\//i.test(lead.businessWebsite.trim())) {
    websitePoints = 25;
    websiteAvailable = true;
    details.push(`Website (+25): Official verified website available in public record (${lead.businessWebsite})`);
  } else {
    websitePoints = 0;
    websiteAvailable = false;
    details.push('Website (+0): No official website documented in Wikidata (missing data not penalized)');
  }

  // --- 4. PROFESSIONAL ACTIVITY EVIDENCE (Max 15 points) ---
  let activityPoints = 0;
  let activeEvidence: string | undefined;

  if (lead.isDeceased) {
    activityPoints = 0;
    activeEvidence = 'Documented as deceased in public record';
    details.push('Activity (+0): Entity is documented as deceased');
  } else if (lead.entityPeriod === 'historical') {
    activityPoints = 0;
    activeEvidence = 'Pre-modern historical entity';
    details.push('Activity (+0): Pre-modern historical entity');
  } else if (websiteAvailable) {
    activityPoints = 15;
    activeEvidence = 'Active contemporary web domain present in Wikidata record';
    details.push('Activity (+15): Contemporary entity with active verified web presence');
  } else {
    activityPoints = 5;
    activeEvidence = 'Contemporary living entity; active status unconfirmed without direct website';
    details.push('Activity (+5): Contemporary living individual; current day-to-day activity unconfirmed');
  }

  const score = Math.min(Math.max(occupationPoints + nichePoints + websitePoints + activityPoints, 0), 100);

  const breakdown: RelevanceBreakdown = {
    occupationMatch,
    occupationPoints,
    nicheMatch,
    nichePoints,
    websiteAvailable,
    websitePoints,
    activityEvidence: activityPoints > 0,
    activityPoints,
    details
  };

  // Explanation string
  const explanation = `Score ${score}/100: ${details.join('. ')}.`;

  // --- 5. LEAD STATUS CLASSIFICATION ---
  // Distinguish: Discovered | Relevant | Contact Available | Qualified Prospect
  let classification: B2BLeadClassification = 'Discovered';

  if (lead.isDeceased || lead.entityPeriod === 'historical' || score < 40 || !occupationMatch) {
    classification = 'Discovered';
  } else if (!websiteAvailable) {
    classification = 'Relevant';
  } else if (score >= 70 && occupationPoints >= 25) {
    classification = 'Qualified Prospect';
  } else {
    classification = 'Contact Available';
  }

  return {
    score,
    breakdown,
    explanation,
    classification,
    activeEvidence
  };
}

/**
 * Enriches a RawLead with historical intelligence, relevance scoring, and classification.
 */
export function enrichRawLead(
  raw: RawLead,
  filters: LeadFilter,
  clientNiche?: string,
  rawDateOfDeath?: string,
  rawDateOfBirth?: string
): RawLead {
  const historical = detectHistoricalStatus(
    rawDateOfDeath || raw.dateOfDeath,
    rawDateOfBirth || raw.dateOfBirth,
    raw.headline,
    raw.currentJobTitle
  );

  const relevance = calculateRelevanceScore(
    {
      fullName: raw.fullName,
      headline: raw.headline,
      currentJobTitle: raw.currentJobTitle,
      businessWebsite: raw.businessWebsite,
      isDeceased: historical.isDeceased,
      entityPeriod: historical.entityPeriod
    },
    filters,
    clientNiche
  );

  return {
    ...raw,
    isDeceased: historical.isDeceased,
    dateOfDeath: historical.dateOfDeath,
    dateOfBirth: historical.dateOfBirth,
    entityPeriod: historical.entityPeriod,
    relevanceScore: relevance.score,
    relevanceExplanation: relevance.explanation,
    relevanceBreakdown: relevance.breakdown,
    b2bClassification: relevance.classification,
    activeEvidence: relevance.activeEvidence
  };
}

/**
 * Enriches a LeadRecord with relevance and classification properties.
 */
export function enrichLeadRecord(
  lead: LeadRecord,
  filters: LeadFilter,
  clientNiche?: string
): LeadRecord {
  const historical = detectHistoricalStatus(
    lead.dateOfDeath,
    lead.dateOfBirth,
    lead.headline,
    lead.currentJobTitle
  );

  const relevance = calculateRelevanceScore(
    {
      fullName: lead.fullName,
      headline: lead.headline,
      currentJobTitle: lead.currentJobTitle,
      businessWebsite: lead.businessWebsite,
      isDeceased: historical.isDeceased,
      entityPeriod: historical.entityPeriod
    },
    filters,
    clientNiche
  );

  return {
    ...lead,
    isDeceased: historical.isDeceased,
    dateOfDeath: historical.dateOfDeath,
    dateOfBirth: historical.dateOfBirth,
    entityPeriod: historical.entityPeriod,
    relevanceScore: relevance.score,
    relevanceExplanation: relevance.explanation,
    relevanceBreakdown: relevance.breakdown,
    b2bClassification: relevance.classification,
    activeEvidence: relevance.activeEvidence
  };
}
