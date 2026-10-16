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

  static async verifyClientAuthorization(
    workspaceId: string,
    clientId: string,
    userId?: string
  ): Promise<boolean> {
    if (!workspaceId || !clientId || !userId || !userId.trim()) return false;

    // Supabase validation if connected
    if (supabase && process.env.NODE_ENV !== 'test') {
      try {
        const timeout = AbortSignal.timeout(3000);
        const { data, error } = await supabase
          .from('clients')
          .select('id, workspace_id, created_by')
          .eq('id', clientId)
          .eq('workspace_id', workspaceId)
          .abortSignal(timeout)
          .maybeSingle();

        if (error || !data) {
          return false;
        }

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id, role, workspace_id')
          .eq('id', userId)
          .eq('workspace_id', workspaceId)
          .abortSignal(timeout)
          .maybeSingle();

        if (userError || !userData) {
          return false;
        }

        if (userData.role === 'member' && data.created_by && data.created_by !== userId) {
          return false;
        }

        return true;
      } catch {
        // Fall back to local check
      }
    }

    // In-memory registered clients check (for test and local offline execution)
    const wsClients = localRegisteredClients.get(workspaceId);
    if (wsClients) {
      const client = wsClients.get(clientId);
      if (!client) {
        return false;
      }
      if (client.createdBy && client.createdBy !== userId) {
        return false;
      }
      return true;
    }

    // Check if other workspaces have registered this client (prevent cross-tenant hijacking)
    for (const [otherWsId, otherClients] of localRegisteredClients.entries()) {
      if (otherWsId !== workspaceId && otherClients.has(clientId)) {
        return false;
      }
    }

    return Boolean(clientId.trim() && workspaceId.trim() && userId.trim());
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
