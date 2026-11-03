import { supabase } from './supabase';
import { dbService } from './storage';
import {
  Client,
  LeadRecord,
  LeadStatus,
  SearchHistoryRecord,
  RawLead,
  LeadFilter,
  InstagramVerificationStatus,
  GoogleIntegration,
  ExportHistoryRecord,
  Organization,
  Workspace
} from '../types';
import { apiUrl } from './apiClient';
import { getAuthToken } from './auth';

export type LeadPersistenceStatus = 'confirmed' | 'pending' | 'failed';

async function callDataApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; status: number; error?: string }> {
  try {
    const url = apiUrl(endpoint);
    const token = await getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {})
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      ...options,
      headers
    });

    const resJson = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        error: resJson.error || `API returned status ${res.status}`
      };
    }
    return {
      success: true,
      status: res.status,
      data: resJson as T
    };
  } catch (err: any) {
    return {
      success: false,
      status: 0,
      error: err.message || 'Network request failed'
    };
  }
}

export const resolveAuthToken = async (): Promise<string | null> => {
    return getAuthToken();
};

export class SupabaseDataService {
  /**
   * Helper to expose the auth token for external services.
   */
  static async resolveAuthToken(): Promise<string | null> {
    return getAuthToken();
  }

  /**
   * Onboard user and resolve organization context
   */
  static async onboardUser(): Promise<{ onboarded: boolean; organization: Organization; workspaces: Workspace[] }> {
    const res = await callDataApi<{ onboarded: boolean; organization: Organization; workspaces: Workspace[] }>(
        '/api/onboard',
        { method: 'POST' }
    );
    if (!res.success || !res.data) throw new Error(res.error || 'Onboarding failed');
    return res.data;
  }

  /**
   * Fetch all clients for the given workspace.
   */
  static async getClients(workspaceId: string): Promise<Client[]> {
    if (!workspaceId) return [];
    const apiRes = await callDataApi<{ clients: Client[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/clients`
    );
    if (apiRes.success && Array.isArray(apiRes.data?.clients)) {
      return apiRes.data.clients;
    }
    return dbService.getClients(workspaceId);
  }

  /**
   * Create a new client record.
   */
  static async createClient(
    workspaceId: string,
    name: string,
    niche: string,
    notes: string
  ): Promise<Client> {
    if (!workspaceId || !workspaceId.trim()) {
      throw new Error('Workspace ID is required.');
    }
    if (!name || !name.trim()) {
      throw new Error('Client name is required.');
    }
    if (!niche || !niche.trim()) {
      throw new Error('Business / Niche is required.');
    }
    const apiRes = await callDataApi<{ client: Client }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/clients`,
      {
        method: 'POST',
        body: JSON.stringify({ name, niche, notes })
      }
    );
    if (apiRes.success && apiRes.data?.client) return apiRes.data.client;
    return dbService.addClient(workspaceId, name, niche, notes);
  }

  /**
   * Update client details.
   */
  static async updateClient(
    workspaceId: string,
    clientId: string,
    updates: { name?: string; niche?: string; notes?: string }
  ): Promise<Client> {
    const apiRes = await callDataApi<{ client: Client }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/clients/${encodeURIComponent(clientId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates)
      }
    );
    if (apiRes.success && apiRes.data?.client) return apiRes.data.client;
    return dbService.updateClient(workspaceId, clientId, updates);
  }

  /**
   * Delete client.
   */
  static async deleteClient(workspaceId: string, clientId: string): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/clients/${encodeURIComponent(clientId)}`,
      { method: 'DELETE' }
    );
    if (apiRes.success) return;
    dbService.deleteClient(workspaceId, clientId);
  }

  /**
   * Retrieve all leads.
   */
  static async getAllLeads(workspaceId: string, clientId?: string): Promise<LeadRecord[]> {
    if (!workspaceId) return [];
    const apiRes = await callDataApi<{ leads: LeadRecord[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`
    );
    if (apiRes.success && Array.isArray(apiRes.data?.leads)) {
      return apiRes.data.leads;
    }
    return clientId ? dbService.getLeadsForClient(workspaceId, clientId) : dbService.getAllLeads(workspaceId);
  }

  /**
   * Save newly discovered leads.
   */
  static async saveLeadsForClient(
    workspaceId: string,
    clientId: string,
    newLeads: LeadRecord[],
    searchId?: string
  ): Promise<{ added: number; persistenceStatus: LeadPersistenceStatus; persistenceMessage: string }> {
    const apiRes = await callDataApi<{
      success: boolean;
      added: number;
      persistenceStatus: LeadPersistenceStatus;
      persistenceMessage: string;
    }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/leads`, {
      method: 'POST',
      body: JSON.stringify({ clientId, leads: newLeads, searchId })
    });
    if (!apiRes.success || !apiRes.data) throw new Error(apiRes.error || 'Failed to save leads.');
    return apiRes.data;
  }

  /**
   * Update individual lead status.
   */
  static async updateLeadStatus(workspaceId: string, leadId: string, status: LeadStatus): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads/${encodeURIComponent(leadId)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) }
    );
    if (!apiRes.success) throw new Error(apiRes.error || 'Failed to update lead status.');
  }

  /**
   * Update lead notes.
   */
  static async updateLeadNotes(workspaceId: string, leadId: string, notes: string): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads/${encodeURIComponent(leadId)}/notes`,
      { method: 'PATCH', body: JSON.stringify({ notes }) }
    );
    if (!apiRes.success) throw new Error(apiRes.error || 'Failed to update lead notes.');
  }

  /**
   * Update lead Instagram information.
   */
  static async updateLeadInstagram(
    workspaceId: string,
    leadId: string,
    instagramData: any
  ): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads/${encodeURIComponent(leadId)}/instagram`,
      { method: 'PATCH', body: JSON.stringify({ instagramData }) }
    );
    if (!apiRes.success) throw new Error(apiRes.error || 'Failed to update Instagram data.');
  }

  /**
   * Delete selected leads.
   */
  static async deleteSelectedLeads(workspaceId: string, leadIds: string[]): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads/delete-selected`,
      { method: 'POST', body: JSON.stringify({ leadIds }) }
    );
    if (!apiRes.success) throw new Error(apiRes.error || 'Failed to delete leads.');
  }

  /**
   * Fetch searches history.
   */
  static async getSearches(workspaceId: string): Promise<SearchHistoryRecord[]> {
    const apiRes = await callDataApi<{ searches: SearchHistoryRecord[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/searches`
    );
    return apiRes.data?.searches || [];
  }

  /**
   * Save search history record.
   */
  static async saveSearchRecord(
    workspaceId: string,
    clientId: string,
    clientName: string,
    filters: LeadFilter,
    candidatesFound: number,
    validLeads: number,
    duplicatesRemoved: number,
    finalLeadCount: number,
    createdBy: string,
    searchId?: string
  ): Promise<SearchHistoryRecord> {
    const apiRes = await callDataApi<{ search: SearchHistoryRecord }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/searches`,
      {
        method: 'POST',
        body: JSON.stringify({
          searchId,
          clientId,
          clientName,
          filters,
          candidatesFound,
          validLeads,
          duplicatesRemoved,
          finalLeadCount,
          createdBy
        })
      }
    );
    if (apiRes.success && apiRes.data?.search) return apiRes.data.search;
    throw new Error(apiRes.error || 'Failed to save search history.');
  }

  /**
   * Fetch Google Sheets integration details.
   */
  static async getGoogleIntegration(workspaceId: string, clientId: string): Promise<GoogleIntegration | undefined> {
    const apiRes = await callDataApi<{ integration?: GoogleIntegration }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/google-integrations?clientId=${encodeURIComponent(clientId)}`
    );
    return apiRes.data?.integration;
  }

  /**
   * Persist Google Sheets integration details.
   */
  static async saveGoogleIntegration(workspaceId: string, integration: GoogleIntegration): Promise<void> {
    await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/google-integrations`,
      { method: 'POST', body: JSON.stringify(integration) }
    );
  }

  /**
   * Fetch Google Sheets export history.
   */
  static async getExportHistory(workspaceId: string, clientId?: string): Promise<ExportHistoryRecord[]> {
    const apiRes = await callDataApi<{ history?: ExportHistoryRecord[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/export-history${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`
    );
    return apiRes.data?.history || [];
  }

  /**
   * Persist Google Sheets export history record.
   */
  static async saveExportHistory(workspaceId: string, record: ExportHistoryRecord): Promise<void> {
    await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/export-history`,
      { method: 'POST', body: JSON.stringify(record) }
    );
  }

  /**
   * Fetch all team members for an organization.
   */
  static async getTeamMembers(orgId: string): Promise<any[]> {
    const apiRes = await callDataApi<{ members: any[] }>(
      `/api/organizations/${encodeURIComponent(orgId)}/members`
    );
    return apiRes.data?.members || [];
  }

  /**
   * Fetch all pending invitations for an organization.
   */
  static async getTeamInvitations(orgId: string): Promise<any[]> {
    const apiRes = await callDataApi<{ invitations: any[] }>(
      `/api/organizations/${encodeURIComponent(orgId)}/invitations`
    );
    return apiRes.data?.invitations || [];
  }

  /**
   * Invite a new member to the team.
   */
  static async inviteTeamMember(orgId: string, email: string, role: string): Promise<any> {
    const apiRes = await callDataApi<{ invitation: any }>(
      `/api/organizations/${encodeURIComponent(orgId)}/invitations`,
      {
        method: 'POST',
        body: JSON.stringify({ email, role })
      }
    );
    if (apiRes.success && apiRes.data?.invitation) return apiRes.data.invitation;
    throw new Error(apiRes.error || 'Failed to send invitation.');
  }

  /**
   * Revoke a pending invitation.
   */
  static async revokeInvitation(orgId: string, invId: string): Promise<void> {
    const apiRes = await callDataApi(
      `/api/organizations/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(invId)}`,
      { method: 'DELETE' }
    );
    if (!apiRes.success) throw new Error(apiRes.error || 'Failed to revoke invitation.');
  }

  static generateUuid(): string {
    return crypto.randomUUID();
  }
}
