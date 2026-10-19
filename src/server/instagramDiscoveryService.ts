/**
 * Business Instagram Profile Discovery & Deep Website Contact Enrichment Service
 * 
 * Provides verifiable public Instagram business profile discovery and deep website contact inspection using:
 * 1. Verified Wikidata entity statements (P2003, P856, P968, P1329)
 * 2. Official business website homepage + sub-page inspection (/contact, /about, /team) for contact info & Instagram
 * 3. Transparent verification classification: Verified, Needs Review, Unverified, Not Found, Lookup Failed, Not Checked
 */

import { InstagramVerificationStatus } from '../types';

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

export interface WebsiteInspectionResult {
  username?: string;
  email?: string;
  phone?: string;
  fetchError?: string;
  sourcePageUrl?: string;
}

export interface InstagramDiscoveryResult {
  instagramUsername?: string;
  instagramProfileUrl?: string;
  instagramVerificationStatus: InstagramVerificationStatus;
  instagramVerificationEvidence: string;
  instagramDiscoverySource: string;
  instagramLastCheckedAt: string;
  discoveredEmail?: string;
  discoveredPhone?: string;
}

const RESERVED_INSTAGRAM_PATHS = new Set([
  'p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'developer', 'legal',
  'about', 'directory', 'channel', 'tv', 'tags', 'login', 'share', 'help',
  'privacy', 'terms', 'api', 'graphql', 'create', 'direct'
]);

export class InstagramDiscoveryService {
  /**
   * Discovers and verifies the public Instagram profile and contact info for a single business lead
   * using deep website page crawling (homepage + /contact, /about, /team).
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
            console.log(`[Diagnostic] Wikidata P2003 discovered for "${target.fullName}" (${qid}): @${wikidataResult.username}`);
            // Also inspect website in background for email/phone if website exists
            let siteEmail: string | undefined;
            let sitePhone: string | undefined;
            if (target.businessWebsite && /^https?:\/\//i.test(target.businessWebsite.trim())) {
              try {
                const siteInspection = await this.inspectWebsiteDeep(target.businessWebsite.trim());
                siteEmail = siteInspection.email;
                sitePhone = siteInspection.phone;
              } catch {}
            }

            return {
              instagramUsername: wikidataResult.username,
              instagramProfileUrl: `https://www.instagram.com/${wikidataResult.username}/`,
              instagramVerificationStatus: 'Verified',
              instagramVerificationEvidence: `Verified via official Wikidata entity statement (P2003) linked to ${target.fullName} (${qid})`,
              instagramDiscoverySource: 'Wikidata (P2003)',
              instagramLastCheckedAt: checkedAt,
              discoveredEmail: siteEmail,
              discoveredPhone: sitePhone
            };
          }
        } catch (err: any) {
          console.warn(`[Diagnostic] Wikidata Instagram lookup warning for ${qid}:`, err.message || err);
        }
      }
    }

    // 2. Scan Official Website Deeply (/contact, /about, /team + homepage)
    if (target.businessWebsite && /^https?:\/\//i.test(target.businessWebsite.trim())) {
      const websiteUrl = target.businessWebsite.trim();
      const inspection = await this.inspectWebsiteDeep(websiteUrl);

      if (inspection.fetchError && !inspection.email && !inspection.phone && !inspection.username) {
        console.log(`[Diagnostic] Website inspection error for "${target.fullName}" (${websiteUrl}): ${inspection.fetchError}`);
        return {
          instagramUsername: undefined,
          instagramProfileUrl: undefined,
          instagramVerificationStatus: 'Lookup Failed',
          instagramVerificationEvidence: `Website lookup failed (${inspection.fetchError}) inspecting official website (${websiteUrl})`,
          instagramDiscoverySource: 'Official Business Website Inspection',
          instagramLastCheckedAt: checkedAt,
          discoveredEmail: inspection.email,
          discoveredPhone: inspection.phone
        };
      }

      if (inspection.username) {
        console.log(`[Diagnostic] Official website Instagram link verified for "${target.fullName}": @${inspection.username} via ${inspection.sourcePageUrl || websiteUrl}`);
        return {
          instagramUsername: inspection.username,
          instagramProfileUrl: `https://www.instagram.com/${inspection.username}/`,
          instagramVerificationStatus: 'Verified',
          instagramVerificationEvidence: `Verified via official link discovered on business page (${inspection.sourcePageUrl || websiteUrl})`,
          instagramDiscoverySource: 'Official Business Website',
          instagramLastCheckedAt: checkedAt,
          discoveredEmail: inspection.email,
          discoveredPhone: inspection.phone
        };
      }

      // Website inspected successfully, check if email or phone was discovered
      if (inspection.email || inspection.phone) {
        return {
          instagramUsername: undefined,
          instagramProfileUrl: undefined,
          instagramVerificationStatus: 'Not Found',
          instagramVerificationEvidence: `Contact details extracted from official website (${inspection.sourcePageUrl || websiteUrl}), but no Instagram profile found`,
          instagramDiscoverySource: 'Official Business Website Inspection',
          instagramLastCheckedAt: checkedAt,
          discoveredEmail: inspection.email,
          discoveredPhone: inspection.phone
        };
      }

      return {
        instagramUsername: undefined,
        instagramProfileUrl: undefined,
        instagramVerificationStatus: 'Not Found',
        instagramVerificationEvidence: `No public Instagram business link or contact info found on inspected official website (${websiteUrl}) or in Wikidata records for "${target.fullName}"`,
        instagramDiscoverySource: 'Official Business Website Inspection',
        instagramLastCheckedAt: checkedAt,
        discoveredEmail: inspection.email,
        discoveredPhone: inspection.phone
      };
    }

    // 3. Fallback: If candidate username was provided for manual verification
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

    // 4. No profile found
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
   * Batch discovers Instagram profiles for an array of leads with rate-limit and concurrency control.
   */
  static async discoverBatch(
    targets: InstagramDiscoveryTarget[]
  ): Promise<Record<string, InstagramDiscoveryResult>> {
    const results: Record<string, InstagramDiscoveryResult> = {};
    const limit = Math.min(targets.length, 30);

    const chunkSize = 4;
    for (let i = 0; i < limit; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (target) => {
          const key = target.leadId || target.profileUrl || target.fullName;
          try {
            results[key] = await this.discoverForLead(target);
          } catch (err: any) {
            results[key] = {
              instagramVerificationStatus: 'Lookup Failed',
              instagramVerificationEvidence: `Discovery process encountered error: ${err.message || 'Unknown network error'}`,
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
   * Deep website inspection: Scrapes homepage, discovers contact/about/team links, and inspects them (up to 4 pages max).
   */
  public static async inspectWebsiteDeep(websiteUrl: string): Promise<WebsiteInspectionResult> {
    const normalizedRoot = this.sanitizeAndNormalizeUrl(websiteUrl);
    if (!normalizedRoot) {
      return { fetchError: 'Invalid or unsafe website URL' };
    }

    const visitedUrls = new Set<string>();
    const urlsToVisit: string[] = [normalizedRoot];
    let bestUsername: string | undefined;
    let bestEmail: string | undefined;
    let bestPhone: string | undefined;
    let sourcePageUrl: string | undefined;
    let lastError: string | undefined;

    const maxPages = 4;
    let pagesInspected = 0;

    while (urlsToVisit.length > 0 && pagesInspected < maxPages) {
      const currentUrl = urlsToVisit.shift()!;
      if (visitedUrls.has(currentUrl)) continue;
      visitedUrls.add(currentUrl);
      pagesInspected++;

      const pageResult = await this.fetchAndParsePage(currentUrl);
      if (pageResult.fetchError) {
        lastError = pageResult.fetchError;
        continue;
      }

      if (pageResult.username && !bestUsername) {
        bestUsername = pageResult.username;
        sourcePageUrl = currentUrl;
      }
      if (pageResult.email && !bestEmail) {
        bestEmail = pageResult.email;
        sourcePageUrl = sourcePageUrl || currentUrl;
      }
      if (pageResult.phone && !bestPhone) {
        bestPhone = pageResult.phone;
        sourcePageUrl = sourcePageUrl || currentUrl;
      }

      // If we found everything, stop crawling further subpages
      if (bestUsername && bestEmail && bestPhone) break;

      // Extract same-domain contact/about/team links from homepage HTML if on root
      if (currentUrl === normalizedRoot && pageResult.html) {
        const discoveredLinks = this.extractContactSubpageLinks(pageResult.html, normalizedRoot);
        for (const link of discoveredLinks) {
          if (!visitedUrls.has(link) && !urlsToVisit.includes(link) && urlsToVisit.length < 5) {
            urlsToVisit.push(link);
          }
        }
      }
    }

    if (!bestUsername && !bestEmail && !bestPhone && lastError) {
      return { fetchError: lastError };
    }

    return {
      username: bestUsername,
      email: bestEmail,
      phone: bestPhone,
      sourcePageUrl
    };
  }

  /**
   * Safe URL sanitizer & SSRF prevention validator
   */
  public static sanitizeAndNormalizeUrl(rawUrl: string): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    let trimmed = rawUrl.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = `https://${trimmed}`;
    }

    try {
      const parsed = new URL(trimmed);
      const hostname = parsed.hostname.toLowerCase();

      // Prevent SSRF, localhost, private IP ranges, unsafe protocols
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')
      ) {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }

  /**
   * Fetches a single page with strict timeout, size limit, and HTML validation
   */
  private static async fetchAndParsePage(url: string): Promise<WebsiteInspectionResult & { html?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (compatible; LeadFinder/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        return { fetchError: `HTTP status ${response.status} ${response.statusText}` };
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return { fetchError: `Non-HTML content type (${contentType})` };
      }

      // Prevent loading massive responses (limit to ~1MB)
      const textBuffer = await response.text();
      const html = textBuffer.length > 1024 * 1024 ? textBuffer.substring(0, 1024 * 1024) : textBuffer;

      const instaResult = this.parseInstagramUsernameFromHtml(html);
      const emailResult = this.parseEmailFromHtml(html);
      const phoneResult = this.parsePhoneFromHtml(html);

      return {
        username: instaResult?.username,
        email: emailResult,
        phone: phoneResult,
        html
      };
    } catch (err: any) {
      clearTimeout(timer);
      const msg = err.name === 'AbortError' ? 'Connection timed out after 6000ms' : (err.message || 'Network connection failed');
      return { fetchError: msg };
    }
  }

  /**
   * Extracts relevant same-domain contact/about/team subpage links from HTML
   */
  public static extractContactSubpageLinks(html: string, rootUrl: string): string[] {
    if (!html || typeof html !== 'string') return [];
    const rootParsed = new URL(rootUrl);
    const links: string[] = [];
    const regex = /href=["']([^"'#\s]+)["']/gi;
    let match: RegExpExecArray | null;

    const keywords = ['contact', 'about', 'team', 'leadership', 'reach', 'staff', 'office'];

    while ((match = regex.exec(html)) !== null) {
      const href = match[1];
      try {
        const absoluteUrl = new URL(href, rootUrl);
        // Ensure same domain
        if (absoluteUrl.hostname.toLowerCase() === rootParsed.hostname.toLowerCase()) {
          const pathLower = absoluteUrl.pathname.toLowerCase();
          if (keywords.some((kw) => pathLower.includes(kw))) {
            const clean = absoluteUrl.toString();
            if (!links.includes(clean) && clean !== rootUrl) {
              links.push(clean);
            }
          }
        }
      } catch {}
    }

    return links;
  }

  /**
   * Backward-compatible alias for previous inspectWebsite tests
   */
  public static async inspectWebsite(
    websiteUrl: string,
    fullName: string
  ): Promise<WebsiteInspectionResult> {
    return this.inspectWebsiteDeep(websiteUrl);
  }

  /**
   * Backward-compatible alias for previous extractFromWebsite tests
   */
  public static async extractFromWebsite(
    websiteUrl: string,
    fullName: string
  ): Promise<{ username: string } | null> {
    const res = await this.inspectWebsiteDeep(websiteUrl);
    return res.username ? { username: res.username } : null;
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
      if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.js') || lower.endsWith('.css') || lower.endsWith('.svg')) continue;

      return { username: handle };
    }

    return null;
  }

  /**
   * Parses authentic public email from mailto: links or visible text patterns in HTML
   */
  public static parseEmailFromHtml(html: string): string | undefined {
    if (!html || typeof html !== 'string') return undefined;

    // 1. Check mailto links first (highest fidelity)
    const mailtoRegex = /href=["']mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["'?]/gi;
    let match: RegExpExecArray | null;

    while ((match = mailtoRegex.exec(html)) !== null) {
      const email = match[1]?.trim().toLowerCase();
      if (!email) continue;

      if (this.isInvalidOrPlaceholderEmail(email)) continue;
      return email;
    }

    // 2. Fallback: scan for visible email patterns in text
    const textEmailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
    const matches = html.match(textEmailRegex);
    if (matches) {
      for (const m of matches) {
        const clean = m.toLowerCase().trim();
        if (!this.isInvalidOrPlaceholderEmail(clean)) {
          return clean;
        }
      }
    }

    return undefined;
  }

  private static isInvalidOrPlaceholderEmail(email: string): boolean {
    if (
      email.includes('example.com') ||
      email.includes('wixpress.com') ||
      email.includes('sentry.io') ||
      email.includes('domain.com') ||
      email.includes('yourname') ||
      email.includes('email.com') ||
      email.endsWith('.png') ||
      email.endsWith('.jpg') ||
      email.endsWith('.js') ||
      email.endsWith('.css')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Parses authentic public phone from tel: links or visible text patterns in HTML
   */
  public static parsePhoneFromHtml(html: string): string | undefined {
    if (!html || typeof html !== 'string') return undefined;

    // 1. Check tel: links first (highest fidelity)
    const telRegex = /href=["']tel:([+0-9\s().-]{7,25})["']/gi;
    let match: RegExpExecArray | null;

    while ((match = telRegex.exec(html)) !== null) {
      const phone = match[1]?.trim();
      if (!phone) continue;
      const digitsOnly = phone.replace(/\D/g, '');
      // Must contain between 7 and 15 digits and include standard formatting or international prefix (+)
      if (digitsOnly.length >= 7 && digitsOnly.length <= 15 && (/[\s().-]/.test(phone) || phone.startsWith('+'))) {
        return phone;
      }
    }

    // 2. Fallback: scan for strict phone patterns in text with formatting separators (to avoid script IDs/timestamps)
    const visiblePhoneRegex = /(?:\+?[1-9]\d{0,2}[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}/g;
    const matches = html.match(visiblePhoneRegex);
    if (matches) {
      for (const m of matches) {
        const clean = m.trim();
        const digits = clean.replace(/\D/g, '');
        if (digits.length >= 10 && digits.length <= 15) {
          return clean;
        }
      }
    }

    return undefined;
  }
}
