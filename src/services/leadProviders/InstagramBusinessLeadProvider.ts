import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';

const DEFAULT_GRAPH_API_VERSION = 'v25.0';
const REQUEST_TIMEOUT_MS = 5500;
const SEARCH_TIMEOUT_MS = 7000;
const MAX_USERNAME_LOOKUPS = 20;
const LOOKUP_CONCURRENCY = 2;
const SOURCE_NAME = 'Instagram Graph API Business Discovery';

interface InstagramBusinessProfile {
  username?: unknown;
  name?: unknown;
  biography?: unknown;
  website?: unknown;
  followers_count?: unknown;
}

interface GraphApiErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class InstagramBusinessProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = 'InstagramBusinessProviderError';
  }
}

function normalizeUsername(value: string): string {
  const username = value.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
    throw new InstagramBusinessProviderError(
      'Instagram usernames must be valid public account handles (letters, numbers, periods, and underscores).',
      400
    );
  }
  return username;
}

function getConfiguredVersion(): string {
  const version = process.env.INSTAGRAM_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new InstagramBusinessProviderError('Instagram Graph API version configuration is invalid.', 500);
  }
  return version;
}

function safeWebsite(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const website = new URL(value.trim());
    return website.protocol === 'https:' || website.protocol === 'http:'
      ? website.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function toLead(profile: InstagramBusinessProfile, requestedUsername: string): RawLead | null {
  const returnedUsername =
    typeof profile.username === 'string' ? profile.username.trim() : '';
  if (
    !returnedUsername ||
    !/^[A-Za-z0-9._]{1,30}$/.test(returnedUsername) ||
    returnedUsername.toLowerCase() !== requestedUsername.toLowerCase()
  ) {
    return null;
  }

  const displayName = typeof profile.name === 'string' ? profile.name.trim() : '';
  const username = returnedUsername;
  const biography = typeof profile.biography === 'string' ? profile.biography.trim() : '';
  const followerCount =
    typeof profile.followers_count === 'number' && Number.isFinite(profile.followers_count)
      ? String(profile.followers_count)
      : '';

  return {
    fullName: displayName || username,
    headline: biography,
    currentJobTitle: '',
    companyName: displayName || username,
    location: '',
    profileUrl: `https://www.instagram.com/${username}/`,
    connectionsOrFollowers: followerCount,
    lastActivityDate: 'N/A',
    source: SOURCE_NAME,
    leadType: 'business',
    businessWebsite: safeWebsite(profile.website)
  };
}

export class InstagramBusinessLeadProvider implements LeadProvider {
  readonly providerId = 'instagram-business-discovery-provider';
  readonly providerName = 'Instagram Graph API Business Discovery';
  readonly isMock = false;

  private readonly accessToken: string;
  private readonly instagramUserId: string;
  private readonly graphApiVersion: string;

  constructor(
    accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || '',
    instagramUserId = process.env.INSTAGRAM_USER_ID || ''
  ) {
    this.accessToken = accessToken.trim();
    this.instagramUserId = instagramUserId.trim();
    this.graphApiVersion = getConfiguredVersion();
  }

  private assertConfigured(): void {
    if (!this.accessToken || !this.instagramUserId) {
      throw new InstagramBusinessProviderError(
        'Instagram Business Discovery is not configured. Set the required server-side Meta credentials.',
        503
      );
    }
    if (!/^\d+$/.test(this.instagramUserId)) {
      throw new InstagramBusinessProviderError(
        'Instagram querying account ID configuration is invalid.',
        500
      );
    }
  }

  private async getJson(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`
      },
      signal
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InstagramBusinessProviderError(
        'Meta returned an invalid response while querying Instagram Business Discovery.',
        502
      );
    }

    if (!response.ok) {
      const graphError = (payload as GraphApiErrorBody | null)?.error;
      const code = typeof graphError?.code === 'number' ? graphError.code : undefined;

      if (response.status === 429 || code === 4 || code === 17) {
        throw new InstagramBusinessProviderError(
          'Instagram Graph API rate limit reached. Try again later.',
          429
        );
      }
      if (response.status === 401 || response.status === 403 || code === 190) {
        throw new InstagramBusinessProviderError(
          'Meta rejected the Instagram credentials or required permissions.',
          response.status === 401 ? 401 : 403
        );
      }
      if (code === 100) {
        throw new InstagramBusinessProviderError(
          'Meta could not look up this username. It may be invalid or unavailable for Business Discovery.',
          422
        );
      }
      throw new InstagramBusinessProviderError(
        `Instagram Graph API returned HTTP ${response.status}.`,
        response.status >= 400 && response.status <= 599 ? response.status : 502
      );
    }

    return payload;
  }

  async testConnection(): Promise<void> {
    this.assertConfigured();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const url = new URL(
      `https://graph.facebook.com/${this.graphApiVersion}/${this.instagramUserId}`
    );
    url.searchParams.set('fields', 'id,username');

    try {
      const payload = await this.getJson(url.toString(), timeout);
      const account = payload as { id?: unknown; username?: unknown } | null;
      if (
        !account ||
        typeof account.id !== 'string' ||
        account.id !== this.instagramUserId
      ) {
        throw new InstagramBusinessProviderError(
          'Meta did not verify the configured Instagram professional account.',
          502
        );
      }
    } catch (error) {
      if (error instanceof InstagramBusinessProviderError) throw error;
      if (timeout.aborted) {
        throw new InstagramBusinessProviderError(
          'Instagram Graph API connection test timed out.',
          504
        );
      }
      throw new InstagramBusinessProviderError(
        'Network error connecting to Instagram Graph API.',
        502
      );
    }
  }

  async search(filters: LeadFilter): Promise<RawLead[]> {
    this.assertConfigured();
    if (
      !Array.isArray(filters.instagramUsernames) ||
      filters.instagramUsernames.length === 0
    ) {
      throw new InstagramBusinessProviderError(
        'Instagram Business Discovery cannot search arbitrary businesses by niche or location. Provide one or more known Instagram business usernames.',
        400
      );
    }
    if (filters.instagramUsernames.length > MAX_USERNAME_LOOKUPS) {
      throw new InstagramBusinessProviderError(
        `A single Instagram search can look up at most ${MAX_USERNAME_LOOKUPS} usernames.`,
        400
      );
    }
    if (filters.instagramUsernames.some(username => typeof username !== 'string')) {
      throw new InstagramBusinessProviderError(
        'Instagram usernames must be provided as text handles.',
        400
      );
    }

    const usernames = Array.from(
      new Set(filters.instagramUsernames.map(normalizeUsername).map(username => username.toLowerCase()))
    );

    const maxResults = Math.max(0, Math.min(Math.floor(Number(filters.maxLeads) || 0), 500));
    if (maxResults === 0) return [];

    const work = usernames.slice(0, maxResults);
    const leads: RawLead[] = [];
    const overallTimeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    let nextIndex = 0;

    const lookup = async (username: string): Promise<RawLead | null> => {
      const perRequestTimeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = AbortSignal.any([overallTimeout, perRequestTimeout]);
      const fields = 'username,name,biography,website,followers_count';
      const url = new URL(
        `https://graph.facebook.com/${this.graphApiVersion}/${this.instagramUserId}`
      );
      url.searchParams.set(
        'fields',
        `business_discovery.username(${username}){${fields}}`
      );

      try {
        const payload = await this.getJson(url.toString(), signal);
        const discovery = (
          payload as {
            business_discovery?: InstagramBusinessProfile;
          } | null
        )?.business_discovery;
        return discovery ? toLead(discovery, username) : null;
      } catch (error) {
        if (error instanceof InstagramBusinessProviderError) throw error;
        if (overallTimeout.aborted || perRequestTimeout.aborted) {
          throw new InstagramBusinessProviderError(
            overallTimeout.aborted
              ? 'Instagram Business Discovery exceeded its overall request time budget.'
              : 'An Instagram Business Discovery lookup timed out.',
            504
          );
        }
        throw new InstagramBusinessProviderError(
          'Network error connecting to Instagram Graph API.',
          502
        );
      }
    };

    const worker = async () => {
      while (true) {
        if (overallTimeout.aborted) {
          throw new InstagramBusinessProviderError(
            'Instagram Business Discovery exceeded its overall request time budget.',
            504
          );
        }
        const index = nextIndex++;
        if (index >= work.length) return;
        const lead = await lookup(work[index]);
        if (lead) leads.push(lead);
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(LOOKUP_CONCURRENCY, work.length) },
          () => worker()
        )
      );
    } catch (error) {
      if (overallTimeout.aborted) {
        throw new InstagramBusinessProviderError(
          'Instagram Business Discovery exceeded its overall request time budget.',
          504
        );
      }
      throw error;
    }

    return leads.slice(0, maxResults);
  }
}
