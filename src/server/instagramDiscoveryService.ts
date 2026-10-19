/**
 * Business Instagram Profile Discovery Service
 * 
 * Provides verifiable public Instagram business profile discovery using:
 * 1. Verified Wikidata entity statements (P2003)
 * 2. Official business website HTML inspection for authentic Instagram profile links
 * 3. Transparent verification classification: Verified, Needs Review, Unverified, Not Found
 */

export interface InstagramDiscoveryTarget {
  leadId?: string;
  fullName: string;
  companyName?: string;
  businessWebsite?: string;
  profileUrl?: string;
  location?: string;
  city?: string;
  country?: string;
  businessCategory?: string;
  currentUsername?: string;
}

export interface InstagramDiscoveryResult {
  instagramUsername?: string;
  instagramProfileUrl?: string;
  instagramVerificationStatus: 'Verified' | 'Needs Review' | 'Unverified' | 'Not Found';
  instagramVerificationEvidence: string;
  instagramDiscoverySource: string;
  instagramLastCheckedAt: string;
}

const RESERVED_INSTAGRAM_PATHS = new Set([
  'p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'developer', 'legal',
  'about', 'directory', 'channel', 'tv', 'tags', 'login', 'share', 'help',
  'privacy', 'terms', 'api', 'graphql', 'create', 'direct', 'explore'
]);

export class InstagramDiscoveryService {
  /**
   * Discovers and verifies the public Instagram profile for a single business lead.
   */
  static async discoverForLead(target: InstagramDiscoveryTarget): Promise<InstagramDiscoveryResult> {
    const checkedAt = new Date().toISOString();

    // 1. Check Wikidata Statement (P2003) if lead has a Wikidata profileUrl
    if (target.profileUrl) {
      const qidMatch = target.profileUrl.match(/Q\d+/i);
      if (qidMatch) {
        const qid = qidMatch[0].toUpperCase();
        try {
          const wikidataResult = await this.queryWikidataP2003(qid, target.fullName);
          if (wikidataResult) {
            return {
              instagramUsername: wikidataResult.username,
              instagramProfileUrl: `https://www.instagram.com/${wikidataResult.username}/`,
              instagramVerificationStatus: 'Verified',
              instagramVerificationEvidence: `Verified via official Wikidata entity statement (P2003) linked to ${target.fullName} (${qid})`,
              instagramDiscoverySource: 'Wikidata (P2003)',
              instagramLastCheckedAt: checkedAt
            };
          }
        } catch (err) {
          console.warn(`Wikidata Instagram lookup failed for ${qid}:`, err);
        }
      }
    }

    // 2. Scan Official Website HTML for Verified Instagram links
    if (target.businessWebsite && /^https?:\/\//i.test(target.businessWebsite.trim())) {
      try {
        const websiteResult = await this.extractFromWebsite(target.businessWebsite.trim(), target.fullName);
        if (websiteResult) {
          return {
            instagramUsername: websiteResult.username,
            instagramProfileUrl: `https://www.instagram.com/${websiteResult.username}/`,
            instagramVerificationStatus: 'Verified',
            instagramVerificationEvidence: `Verified via official link discovered directly on business website (${target.businessWebsite})`,
            instagramDiscoverySource: 'Official Business Website',
            instagramLastCheckedAt: checkedAt
          };
        }
      } catch (err) {
        console.warn(`Website Instagram inspection error for ${target.businessWebsite}:`, err);
      }
    }

    // 3. Fallback: If current username was provided for verification
    if (target.currentUsername && /^[a-zA-Z0-9._]{1,30}$/.test(target.currentUsername.replace(/^@/, ''))) {
      const cleanHandle = target.currentUsername.replace(/^@/, '').trim();
      return {
        instagramUsername: cleanHandle,
        instagramProfileUrl: `https://www.instagram.com/${cleanHandle}/`,
        instagramVerificationStatus: 'Needs Review',
        instagramVerificationEvidence: `Candidate handle @${cleanHandle} provided for manual review before outreach`,
        instagramDiscoverySource: 'Manual / Candidate Suggestion',
        instagramLastCheckedAt: checkedAt
      };
    }

    // 4. No profile found through verified public sources
    return {
      instagramUsername: undefined,
      instagramProfileUrl: undefined,
      instagramVerificationStatus: 'Not Found',
      instagramVerificationEvidence: `No public Instagram business profile found in Wikidata records or on official website for "${target.fullName}"`,
      instagramDiscoverySource: 'Inspection Engine',
      instagramLastCheckedAt: checkedAt
    };
  }

  /**
   * Batch discovers Instagram profiles for an array of leads.
   */
  static async discoverBatch(
    targets: InstagramDiscoveryTarget[]
  ): Promise<Record<string, InstagramDiscoveryResult>> {
    const results: Record<string, InstagramDiscoveryResult> = {};
    const limit = Math.min(targets.length, 25);

    // Run sequentially or in small chunks of 4 to prevent rate limiting
    const chunkSize = 4;
    for (let i = 0; i < limit; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (target) => {
          const key = target.leadId || target.profileUrl || target.fullName;
          try {
            results[key] = await this.discoverForLead(target);
          } catch {
            results[key] = {
              instagramVerificationStatus: 'Not Found',
              instagramVerificationEvidence: 'Discovery process could not be completed for this entity',
              instagramDiscoverySource: 'Inspection Engine',
              instagramLastCheckedAt: new Date().toISOString()
            };
          }
        })
      );
    }

    return results;
  }

  /**
   * SPARQL query specifically for P2003 on a given Wikidata entity QID
   */
  private static async queryWikidataP2003(
    qid: string,
    fullName: string
  ): Promise<{ username: string } | null> {
    const sparql = `
      SELECT ?instagram WHERE {
        wd:${qid} wdt:P2003 ?instagram .
      } LIMIT 1
    `;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/sparql-results+json',
          'User-Agent': 'LinkedInLeadFinder/1.0 (https://github.com/leadfinder; mailto:contact@example.com)'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) return null;
      const data = await res.json();
      const bindings = data?.results?.bindings;
      if (Array.isArray(bindings) && bindings.length > 0) {
        const val = bindings[0].instagram?.value;
        if (val) {
          const clean = val.trim().replace(/^@/, '');
          if (/^[a-zA-Z0-9._]{1,30}$/.test(clean)) {
            return { username: clean };
          }
        }
      }
      return null;
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  /**
   * Scrapes website HTML and extracts genuine Instagram links.
   */
  public static async extractFromWebsite(
    websiteUrl: string,
    fullName: string
  ): Promise<{ username: string } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(websiteUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (compatible; LeadFinder/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return null;
      }

      const html = await response.text();
      return this.parseInstagramUsernameFromHtml(html);
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  /**
   * Pure parsing function to extract genuine Instagram handles from HTML text.
   */
  public static parseInstagramUsernameFromHtml(html: string): { username: string } | null {
    if (!html || typeof html !== 'string') return null;

    // Search for instagram.com/username patterns
    const regex = /(?:href=["'])?(?:https?:)?\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,30})\/?["'/\s?#]/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      const handle = match[1]?.trim().replace(/^@/, '');
      if (!handle) continue;
      const lower = handle.toLowerCase();

      // Check if reserved path or invalid
      if (RESERVED_INSTAGRAM_PATHS.has(lower)) continue;
      if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.js') || lower.endsWith('.css')) continue;

      return { username: handle };
    }

    return null;
  }
}
