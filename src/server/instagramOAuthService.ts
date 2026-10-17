import { supabase } from '../services/supabase';
import { encryptAccessToken, decryptAccessToken } from './cryptoService';
import crypto from 'node:crypto';

interface StateRecord {
  workspaceId: string;
  clientId: string;
  userId?: string;
  expiresAt: number;
}
const oauthStates = new Map<string, StateRecord>();

// Clean up expired states every minute without holding the Node.js event loop open
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [state, record] of oauthStates.entries()) {
    if (record.expiresAt < now) {
      oauthStates.delete(state);
    }
  }
}, 60000);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

const localIntegrations = new Map<string, any>();

interface RegisteredClient {
  id: string;
  workspaceId: string;
  createdBy?: string;
}

const localRegisteredClients = new Map<string, Map<string, RegisteredClient>>();

export function registerLocalClient(workspaceId: string, clientId: string, createdBy?: string): void {
  if (!localRegisteredClients.has(workspaceId)) {
    localRegisteredClients.set(workspaceId, new Map());
  }
  localRegisteredClients.get(workspaceId)!.set(clientId, { id: clientId, workspaceId, createdBy });
}

export function clearLocalRegisteredClients(): void {
  localRegisteredClients.clear();
}

export interface ClientAuthorizationResult {
  authorized: boolean;
  status: 200 | 400 | 403 | 503;
  error?: string;
  infrastructureError?: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InstagramOAuthService {
  static createState(workspaceId: string, clientId: string, userId?: string): string {
    const state = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    oauthStates.set(state, { workspaceId, clientId, userId, expiresAt });
    return state;
  }

  static consumeState(state: string): { workspaceId: string; clientId: string; userId?: string } | null {
    const record = oauthStates.get(state);
    if (!record) return null;
    oauthStates.delete(state); // Single-use state
    if (record.expiresAt < Date.now()) return null;
    const result: { workspaceId: string; clientId: string; userId?: string } = {
      workspaceId: record.workspaceId,
      clientId: record.clientId
    };
    if (record.userId !== undefined) {
      result.userId = record.userId;
    }
    return result;
  }

  static async verifyClientAuthorizationDetailed(
    workspaceId: string,
    clientId: string,
    userId?: string,
    userEmail?: string
  ): Promise<ClientAuthorizationResult> {
    if (!workspaceId || !clientId || !userId || !userId.trim()) {
      return {
        authorized: false,
        status: 400,
        error: 'workspaceId, clientId, and verified userId are required.'
      };
    }

    const cleanWsId = workspaceId.trim();
    const cleanClientId = clientId.trim();
    const cleanUserId = userId.trim();

    console.warn(`[AuthDiagnostic] Verification start: user=${cleanUserId}, ws=${cleanWsId}, client=${cleanClientId}`);
    console.warn(`[AuthDiagnostic] Supabase is configured: ${Boolean(supabase)}`);

    // 1. In-memory registered clients check (for test and local offline execution)
    // Check if other workspaces have registered this client (prevent cross-tenant hijacking)
    for (const [otherWsId, otherClients] of localRegisteredClients.entries()) {
      if (otherWsId !== cleanWsId && otherClients.has(cleanClientId)) {
        return {
          authorized: false,
          status: 403,
          error: 'Unauthorized: Client does not belong to the workspace.'
        };
      }
    }

    const wsClients = localRegisteredClients.get(cleanWsId);
    if (wsClients) {
      const client = wsClients.get(cleanClientId);
      if (!client) {
        return {
          authorized: false,
          status: 403,
          error: 'Unauthorized: Client does not belong to the workspace.'
        };
      }
      if (client.createdBy && client.createdBy !== cleanUserId) {
        return {
          authorized: false,
          status: 403,
          error: 'Unauthorized: Requester is not permitted to modify this client.'
        };
      }
      return { authorized: true, status: 200 };
    }

    // 2. Supabase validation if connected
    if (supabase) {
      // Validate UUID format before querying PostgreSQL UUID columns to prevent 22P02 syntax errors
      const areIdsValidUuids = UUID_REGEX.test(cleanClientId) && UUID_REGEX.test(cleanWsId);
      if (!areIdsValidUuids) {
        if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
          console.warn(`[AuthDiagnostic] Non-UUID identifier in production database check: ws=${cleanWsId}, client=${cleanClientId}`);
          return {
            authorized: false,
            status: 403,
            error: 'Unauthorized: Invalid workspace or client identifier format (UUID required).'
          };
        }
      } else {
        try {
          const timeout = AbortSignal.timeout(10000);
          const clientQuery = supabase
            .from('clients')
            .select('id, workspace_id, created_by')
            .eq('id', cleanClientId)
            .eq('workspace_id', cleanWsId);

          const { data, error } = await clientQuery.abortSignal(timeout).maybeSingle();

          if (error) {
            const errMsg = error.message || '';
            const isNetworkFailure =
              errMsg.includes('fetch failed') ||
              errMsg.includes('timeout') ||
              errMsg.includes('ENOTFOUND') ||
              errMsg.includes('ECONNREFUSED');

            if (isNetworkFailure) {
              console.error(`[AuthDiagnostic] Supabase infrastructure error: ${errMsg}`);
              return {
                authorized: false,
                status: 503,
                error: 'Database service is temporarily unavailable. Please verify database connectivity.',
                infrastructureError: true
              };
            }

            console.warn(`[AuthDiagnostic] Client lookup failed: ${errMsg}`);
            if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
              return {
                authorized: false,
                status: 403,
                error: 'Unauthorized: Client does not belong to the workspace or requester is not permitted.'
              };
            }
          } else if (data) {
            // Authoritatively verify user workspace membership against public.users
            let userQuery = supabase.from('users').select('id, role, workspace_id');
            if (UUID_REGEX.test(cleanUserId)) {
              userQuery = userQuery.eq('id', cleanUserId);
            } else if (userEmail) {
              userQuery = userQuery.eq('email', userEmail);
            } else {
              userQuery = userQuery.eq('id', cleanUserId);
            }

            const { data: userData } = await userQuery.maybeSingle();
            if (userData) {
              // Confirm requester actually belongs to this workspace
              if (userData.workspace_id !== cleanWsId) {
                console.warn(`[AuthDiagnostic] Cross-tenant access rejected: user ws=${userData.workspace_id}, req ws=${cleanWsId}`);
                return {
                  authorized: false,
                  status: 403,
                  error: 'Unauthorized: Requester does not belong to the target workspace.'
                };
              }

              // If user is a member and client has specific creator, enforce creator ownership
              if (userData.role === 'member' && data.created_by && userData.id !== data.created_by) {
                console.warn(`[AuthDiagnostic] Member not authorized for client=${cleanClientId}`);
                return {
                  authorized: false,
                  status: 403,
                  error: 'Unauthorized: Member not permitted to modify this client.'
                };
              }
            } else if (data.created_by && data.created_by !== cleanUserId) {
              // Client is owned by another specific user and requester is not that user
              return {
                authorized: false,
                status: 403,
                error: 'Unauthorized: Requester is not permitted to modify this client.'
              };
            }

            return { authorized: true, status: 200 };
          } else {
            // No client record found in Supabase
            if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
              return {
                authorized: false,
                status: 403,
                error: 'Unauthorized: Client does not belong to the workspace or requester is not permitted.'
              };
            }
          }
        } catch (e: any) {
          console.error(`[AuthDiagnostic] Supabase verification error: ${e}`);
          const errMsg = String(e?.message || e || '');
          const isNetworkFailure =
            errMsg.includes('fetch failed') ||
            errMsg.includes('timeout') ||
            errMsg.includes('ENOTFOUND');

          if (isNetworkFailure) {
            return {
              authorized: false,
              status: 503,
              error: 'Database service is temporarily unavailable. Please verify database connectivity.',
              infrastructureError: true
            };
          }

          if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
            return {
              authorized: false,
              status: 403,
              error: 'Unauthorized: Client does not belong to the workspace or requester is not permitted.'
            };
          }
        }
      }
    } else if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      console.error('[AuthDiagnostic] Production environment missing Supabase configuration');
      return {
        authorized: false,
        status: 503,
        error: 'Database configuration missing in production environment.',
        infrastructureError: true
      };
    }

    const isValid = Boolean(cleanClientId && cleanWsId && cleanUserId);
    return {
      authorized: isValid,
      status: isValid ? 200 : 400
    };
  }

  static async verifyClientAuthorization(
    workspaceId: string,
    clientId: string,
    userId?: string
  ): Promise<boolean> {
    const result = await this.verifyClientAuthorizationDetailed(workspaceId, clientId, userId);
    return result.authorized;
  }

  static async getIntegration(workspaceId: string, clientId: string) {
    let raw: any = null;
    if (supabase && process.env.NODE_ENV !== 'test') {
      try {
        const timeout = AbortSignal.timeout(3000);
        const { data, error } = await supabase
          .from('instagram_integrations')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('client_id', clientId)
          .abortSignal(timeout)
          .maybeSingle();

        if (!error && data) {
          raw = data;
        }
      } catch {
        // Fall back to localIntegrations
      }
    }

    if (!raw) {
      raw = localIntegrations.get(`${workspaceId}:${clientId}`);
    }

    if (!raw) return null;

    let connectionStatus = raw.connection_status || raw.connectionStatus || 'Connected';
    const expiresAt = raw.token_expires_at || raw.tokenExpiresAt;
    if (expiresAt) {
      const expTime = new Date(expiresAt).getTime();
      if (Number.isFinite(expTime) && expTime < Date.now()) {
        connectionStatus = 'Expired';
      }
    }

    return {
      id: raw.id || `int-${workspaceId}-${clientId}`,
      instagramUserId: raw.instagram_user_id || raw.instagramUserId,
      instagramUsername: raw.instagram_username || raw.instagramUsername,
      connectionStatus,
      tokenExpiresAt: expiresAt,
      updatedAt: raw.updated_at || raw.updatedAt,
      encryptedAccessToken: raw.encrypted_access_token || raw.encryptedAccessToken
    };
  }

  static async getDecryptedToken(workspaceId: string, clientId: string, userId?: string): Promise<{ accessToken: string; instagramUserId: string } | null> {
    if (userId) {
      const isAuth = await this.verifyClientAuthorization(workspaceId, clientId, userId);
      if (!isAuth) return null;
    }
    const integration = await this.getIntegration(workspaceId, clientId);
    if (!integration || !integration.encryptedAccessToken) return null;
    if (integration.connectionStatus === 'Expired' || integration.connectionStatus === 'Revoked') {
      return null;
    }
    try {
      const accessToken = decryptAccessToken(integration.encryptedAccessToken);
      return {
        accessToken,
        instagramUserId: integration.instagramUserId
      };
    } catch (e) {
      console.error('Failed to decrypt Instagram access token:', e);
      return null;
    }
  }

  static async saveIntegration(
    workspaceId: string,
    clientId: string,
    instagramUserId: string,
    instagramUsername: string,
    plainAccessToken: string,
    tokenExpiresAt?: string
  ): Promise<boolean> {
    const encryptedAccessToken = encryptAccessToken(plainAccessToken);
    const now = new Date().toISOString();

    const record = {
      workspace_id: workspaceId,
      client_id: clientId,
      instagram_user_id: instagramUserId,
      instagram_username: instagramUsername,
      encrypted_access_token: encryptedAccessToken,
      token_expires_at: tokenExpiresAt || null,
      connection_status: 'Connected',
      updated_at: now
    };

    localIntegrations.set(`${workspaceId}:${clientId}`, record);

    if (supabase && process.env.NODE_ENV !== 'test') {
      try {
        const { error } = await supabase
          .from('instagram_integrations')
          .upsert([record], {
            onConflict: 'workspace_id,client_id'
          });

        if (error) {
          console.warn('Supabase instagram_integrations save warning:', error.message);
        }
      } catch (err) {
        console.warn('Supabase instagram_integrations exception:', err);
      }
    }
    return true;
  }

  static async deleteIntegration(workspaceId: string, clientId: string, userId?: string): Promise<boolean> {
    if (userId) {
      const isAuth = await this.verifyClientAuthorization(workspaceId, clientId, userId);
      if (!isAuth) return false;
    }
    localIntegrations.delete(`${workspaceId}:${clientId}`);
    if (supabase && process.env.NODE_ENV !== 'test') {
      try {
        await supabase
          .from('instagram_integrations')
          .delete()
          .eq('workspace_id', workspaceId)
          .eq('client_id', clientId);
      } catch {
        // Ignored
      }
    }
    return true;
  }
}
