import { supabase } from './supabase';
import { dbService } from './storage';
import { Client, LeadRecord, LeadStatus, SearchHistoryRecord, RawLead, LeadFilter, InstagramVerificationStatus } from '../types';
import { apiUrl } from './apiClient';
import { getFirebaseIdToken, getCachedAccessToken } from './auth';

let customAuthTokenProvider: (() => Promise<string | null> | string | null) | null = null;

export function setAuthTokenProvider(provider: (() => Promise<string | null> | string | null) | null): void {
  customAuthTokenProvider = provider;
}

export async function resolveAuthToken(): Promise<string | null> {
  if (customAuthTokenProvider) {
    try {
      const token = await customAuthTokenProvider();
      if (token) return token;
    } catch {
      // Fall through
    }
  }
  try {
    const fbToken = await getFirebaseIdToken();
    if (fbToken) return fbToken;
  } catch {
    // Fall through
  }
  return getCachedAccessToken();
}

async function callDataApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; status: number; error?: string }> {
  try {
    const url = apiUrl(endpoint);
    if (typeof window === 'undefined' && !url.startsWith('http://') && !url.startsWith('https://')) {
      return { success: false, status: 0, error: 'No active HTTP server for relative URL.' };
    }

    const token = await resolveAuthToken();
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

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type LeadPersistenceStatus = 'confirmed' | 'local_only' | 'partial' | 'not_needed';


export interface LeadSaveResult {
  added: number;
  duplicatesSkipped: number;
  persistenceStatus: LeadPersistenceStatus;
  persistenceMessage: string;
}

interface PersistedLeadIdentity {
  id: string;
  profile_url: string;
}

export interface LeadPersistenceWriter {
  upsertLeads(): Promise<{ data: PersistedLeadIdentity[] | null; error: unknown | null }>;
  upsertClientLinks(
    leads: PersistedLeadIdentity[]
  ): Promise<{ confirmedCount: number; error: unknown | null }>;
}

export async function persistLeadsAndLinks(
  localResult: { added: number; duplicatesSkipped: number },
  leadCount: number,
  writer?: LeadPersistenceWriter
): Promise<LeadSaveResult> {
  if (leadCount === 0) {
    return {
      ...localResult,
      persistenceStatus: 'not_needed',
      persistenceMessage: 'No new leads required persistence.'
    };
  }

  if (!writer) {
    return {
      ...localResult,
      persistenceStatus: 'local_only',
      persistenceMessage: 'Leads were saved in this browser only; Supabase is not configured.'
    };
  }

  let leadResult: Awaited<ReturnType<LeadPersistenceWriter['upsertLeads']>>;
  try {
    leadResult = await writer.upsertLeads();
  } catch {
    return {
      ...localResult,
      persistenceStatus: 'local_only',
      persistenceMessage: 'Leads were saved in this browser, but Supabase lead persistence failed.'
    };
  }

  if (leadResult.error || !Array.isArray(leadResult.data) || leadResult.data.length === 0) {
    return {
      ...localResult,
      persistenceStatus: 'local_only',
      persistenceMessage: 'Leads were saved in this browser, but Supabase did not confirm lead persistence.'
    };
  }

  let linkResult: Awaited<ReturnType<LeadPersistenceWriter['upsertClientLinks']>>;
  try {
    linkResult = await writer.upsertClientLinks(leadResult.data);
  } catch {
    linkResult = { confirmedCount: 0, error: new Error('Client-link upsert failed.') };
  }

  if (
    linkResult.error ||
    linkResult.confirmedCount !== leadResult.data.length ||
    leadResult.data.length !== leadCount
  ) {
    return {
      ...localResult,
      persistenceStatus: 'partial',
      persistenceMessage:
        leadResult.data.length !== leadCount
          ? 'Supabase confirmed only some lead records; persistence is incomplete.'
          : 'Some lead records were persisted, but Supabase did not confirm all client links.'
    };
  }

  return {
    ...localResult,
    persistenceStatus: 'confirmed',
    persistenceMessage: 'Supabase confirmed lead persistence and client links.'
  };
}

export class SupabaseDataService {
  /**
   * Check if Supabase client is configured and operational
   */
  static isAvailable(): boolean {
    return Boolean(supabase);
  }

  /**
   * Fetch all clients for the given workspace.
   * Pulls from Supabase if connected, falls back to local storage cache only when Supabase is not configured.
   */
  static async getClients(workspaceId: string): Promise<Client[]> {
    if (!workspaceId || !workspaceId.trim()) {
      return [];
    }

    const apiRes = await callDataApi<{ clients: Client[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/clients`
    );

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }

    if (apiRes.success && Array.isArray(apiRes.data?.clients)) {
      dbService.syncClientsForWorkspace(workspaceId, apiRes.data.clients);
      return apiRes.data.clients;
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase getClients error:', error.message);
        throw new Error(`Failed to load clients from Supabase: ${error.message}`);
      }

      if (Array.isArray(data)) {
        const leads = await this.getAllLeads(workspaceId);
        const searches = await this.getSearches(workspaceId);

        const mapped: Client[] = data.map((c: any) => ({
          id: c.id,
          workspaceId: c.workspace_id,
          name: c.name,
          niche: c.niche || '',
          notes: c.notes || '',
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          leadsCount: leads.filter((l) => l.clientId === c.id).length,
          searchesCount: searches.filter((s) => s.clientId === c.id).length
        }));

        // Synchronize local cache with confirmed Supabase data
        dbService.syncClientsForWorkspace(workspaceId, mapped);
        return mapped;
      }
    }

    return dbService.getClients(workspaceId);
  }

  /**
   * Create a new client record in Supabase and local storage.
   */
  static async createClient(
    workspaceId: string,
    name: string,
    niche: string,
    notes: string
  ): Promise<Client> {
    if (!workspaceId || !workspaceId.trim()) {
      throw new Error('Cannot create client: Workspace ID is required.');
    }
    if (!name || !name.trim()) {
      throw new Error('Cannot create client: Client name is required.');
    }
    if (!niche || !niche.trim()) {
      throw new Error('Cannot create client: Business / Niche is required.');
    }

    const apiRes = await callDataApi<{ client: Client }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/clients`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          niche: niche.trim(),
          notes: (notes || '').trim()
        })
      }
    );

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.status >= 400 && apiRes.error) {
      throw new Error(apiRes.error);
    }
    if (apiRes.success && apiRes.data?.client) {
      dbService.createClientWithId(
        apiRes.data.client.id,
        workspaceId,
        apiRes.data.client.name,
        apiRes.data.client.niche,
        apiRes.data.client.notes,
        apiRes.data.client.createdAt
      );
      return apiRes.data.client;
    }

    const id = generateUuid();
    const now = new Date().toISOString();

    const newClient: Client = {
      id,
      workspaceId,
      name: name.trim(),
      niche: niche.trim(),
      notes: notes.trim(),
      createdAt: now,
      updatedAt: now,
      leadsCount: 0,
      searchesCount: 0
    };

    if (supabase) {
      const { data, error } = await supabase
        .from('clients')
        .insert([
          {
            id,
            workspace_id: workspaceId,
            name: name.trim(),
            niche: niche.trim(),
            notes: notes.trim(),
            created_at: now,
            updated_at: now
          }
        ])
        .select();

      if (error) {
        console.error('Supabase createClient insert error:', error.message);
        throw new Error(`Supabase rejected client creation: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
      }

      if (!data || data.length === 0) {
        throw new Error('Supabase did not return confirmed client record after creation.');
      }
    }

    // Always update local cache once persistence is confirmed
    dbService.createClientWithId(id, workspaceId, name.trim(), niche.trim(), notes.trim(), now);
    return newClient;
  }

  /**
   * Update client details in Supabase and local storage.
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

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success && apiRes.data?.client) {
      dbService.updateClient(workspaceId, clientId, updates);
      return apiRes.data.client;
    }

    const now = new Date().toISOString();

    if (supabase) {
      const dbUpdates: any = { updated_at: now };
      if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
      if (updates.niche !== undefined) dbUpdates.niche = updates.niche.trim();
      if (updates.notes !== undefined) dbUpdates.notes = updates.notes.trim();

      const { error } = await supabase
        .from('clients')
        .update(dbUpdates)
        .eq('id', clientId)
        .eq('workspace_id', workspaceId);

      if (error) {
        console.error('Supabase updateClient error:', error.message);
        throw new Error(`Failed to update client in Supabase: ${error.message}`);
      }
    }

    return dbService.updateClient(workspaceId, clientId, updates);
  }

  /**
   * Delete client and associated records.
   */
  static async deleteClient(workspaceId: string, clientId: string): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/clients/${encodeURIComponent(clientId)}`,
      {
        method: 'DELETE'
      }
    );

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success) {
      dbService.deleteClient(workspaceId, clientId);
      return;
    }

    if (supabase) {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', clientId)
        .eq('workspace_id', workspaceId);

      if (error) {
        console.error('Supabase deleteClient error:', error.message);
        throw new Error(`Failed to delete client from Supabase: ${error.message}`);
      }
    }

    dbService.deleteClient(workspaceId, clientId);
  }


  /**
   * Retrieve all leads for a workspace or filtered by client.
   */
  static async getAllLeads(workspaceId: string, clientId?: string): Promise<LeadRecord[]> {
    const apiRes = await callDataApi<{ leads: LeadRecord[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`
    );

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success && Array.isArray(apiRes.data?.leads)) {
      return apiRes.data.leads;
    }

    if (supabase) {
      try {
        let query = supabase
          .from('leads')
          .select('*')
          .eq('workspace_id', workspaceId);

        const { data, error } = await query.order('created_at', { ascending: false });

        if (!error && Array.isArray(data) && data.length > 0) {
          // If clientId is provided or needed, also fetch junction client_leads
          const { data: junctionData } = await supabase
            .from('client_leads')
            .select('*')
            .eq('workspace_id', workspaceId);

          const junctionMap = new Map<string, any>();
          if (Array.isArray(junctionData)) {
            for (const j of junctionData) {
              junctionMap.set(j.lead_id, j);
            }
          }

          const records: LeadRecord[] = data.map((item: any) => {
            const junction = junctionMap.get(item.id) || {};
            return {
              id: item.id,
              workspaceId: item.workspace_id,
              clientId: junction.client_id || clientId || '',
              searchId: junction.search_id || undefined,
              fullName: item.full_name || 'N/A',
              headline: item.headline || '',
              currentJobTitle: item.current_job_title || 'N/A',
              companyName: item.company_name || 'N/A',
              location: item.location || 'N/A',
              profileUrl: item.profile_url || '',
              connectionsOrFollowers:
                item.lead_type === 'business'
                  ? item.connections_or_followers || ''
                  : item.connections_or_followers || '500+ connections',
              lastActivityDate: item.last_activity_date || 'N/A',
              dateAdded: (item.created_at || new Date().toISOString()).split('T')[0],
              status: (junction.status as LeadStatus) || 'Not Contacted',
              notes: junction.notes || '',
              source: item.source || 'Wikidata SPARQL Query Service',
              leadType: item.lead_type || undefined,
              businessCategory: item.business_category || undefined,
              businessWebsite: item.business_website || undefined,
              businessPhone: item.business_phone || undefined,
              businessAddress: item.business_address || undefined,
              businessCity: item.business_city || undefined,
              businessCountry: item.business_country || undefined,
              latitude: typeof item.latitude === 'number' ? item.latitude : undefined,
              longitude: typeof item.longitude === 'number' ? item.longitude : undefined,
              businessEmail: item.business_email || item.businessEmail || undefined,
              linkedInProfileUrl: item.linkedin_profile_url || item.linkedInProfileUrl || undefined,
              contactSource: item.contact_source || item.contactSource || undefined,
              contactVerificationStatus: item.contact_verification_status || item.contactVerificationStatus || undefined,
              instagramUsername: item.instagram_username || item.instagramUsername || undefined,
              instagramProfileUrl: item.instagram_profile_url || item.instagramProfileUrl || undefined,
              instagramVerificationStatus: item.instagram_verification_status || item.instagramVerificationStatus || undefined,
              instagramVerificationEvidence: item.instagram_verification_evidence || item.instagramVerificationEvidence || undefined,
              instagramDiscoverySource: item.instagram_discovery_source || item.instagramDiscoverySource || undefined,
              instagramLastCheckedAt: item.instagram_last_checked_at || item.instagramLastCheckedAt || undefined,
              relevanceScore: typeof item.relevance_score === 'number' ? item.relevance_score : item.relevanceScore,
              relevanceExplanation: item.relevance_explanation || item.relevanceExplanation,
              relevanceBreakdown: item.relevance_breakdown || item.relevanceBreakdown,
              b2bClassification: item.b2b_classification || item.b2bClassification,
              isDeceased: typeof item.is_deceased === 'boolean' ? item.is_deceased : item.isDeceased,
              dateOfDeath: item.date_of_death || item.dateOfDeath,
              dateOfBirth: item.date_of_birth || item.dateOfBirth,
              entityPeriod: item.entity_period || item.entityPeriod,
              activeEvidence: item.active_evidence || item.activeEvidence
            };
          });

          if (clientId) {
            return records.filter((r) => r.clientId === clientId);
          }
          return records;
        }
      } catch (err) {
        console.warn('Supabase getAllLeads error, falling back to local storage cache:', err);
      }
    }

    if (clientId) {
      return dbService.getLeadsForClient(workspaceId, clientId);
    }
    return dbService.getAllLeads(workspaceId);
  }

  /**
   * Save newly discovered leads for a client into Supabase with deduplication and isolation.
   */
  static async saveLeadsForClient(
    workspaceId: string,
    clientId: string,
    newLeads: LeadRecord[],
    searchId?: string
  ): Promise<LeadSaveResult> {
    // First deduplicate and save in local storage service for synchronous UI update
    const localResult = dbService.saveLeadsForClient(workspaceId, clientId, newLeads);

    const apiRes = await callDataApi<{
      success: boolean;
      added: number;
      duplicatesSkipped: number;
      persistenceStatus: LeadPersistenceStatus;
      persistenceMessage: string;
    }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/leads`, {
      method: 'POST',
      body: JSON.stringify({ clientId, leads: newLeads, searchId })
    });

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success && apiRes.data) {
      return {
        added: apiRes.data.added ?? localResult.added,
        duplicatesSkipped: apiRes.data.duplicatesSkipped ?? localResult.duplicatesSkipped,
        persistenceStatus: apiRes.data.persistenceStatus,
        persistenceMessage: apiRes.data.persistenceMessage
      };
    }

    if (supabase && newLeads.length > 0) {
      const client = supabase;
      const leadRows = newLeads.map((l) => ({
        id: l.id && l.id.length > 20 ? l.id : generateUuid(),
        workspace_id: workspaceId,
        full_name: l.fullName,
        headline: l.headline,
        current_job_title: l.currentJobTitle,
        company_name: l.companyName,
        location: l.location,
        profile_url: l.profileUrl,
        connections_or_followers: l.connectionsOrFollowers,
        last_activity_date: l.lastActivityDate,
        source: l.source || 'Wikidata SPARQL Query Service',
        lead_type: l.leadType || null,
        business_category: l.businessCategory || null,
        business_website: l.businessWebsite || null,
        business_phone: l.businessPhone || null,
        business_address: l.businessAddress || null,
        business_city: l.businessCity || null,
        business_country: l.businessCountry || null,
        latitude: l.latitude ?? null,
        longitude: l.longitude ?? null,
        business_email: l.businessEmail || null,
        linkedin_profile_url: l.linkedInProfileUrl || null,
        contact_source: l.contactSource || null,
        contact_verification_status: l.contactVerificationStatus || null,
        instagram_username: l.instagramUsername || null,
        instagram_profile_url: l.instagramProfileUrl || null,
        instagram_verification_status: l.instagramVerificationStatus || null,
        instagram_verification_evidence: l.instagramVerificationEvidence || null,
        instagram_discovery_source: l.instagramDiscoverySource || null,
        instagram_last_checked_at: l.instagramLastCheckedAt || null,
        relevance_score: l.relevanceScore ?? null,
        relevance_explanation: l.relevanceExplanation || null,
        relevance_breakdown: l.relevanceBreakdown || null,
        b2b_classification: l.b2bClassification || null,
        is_deceased: l.isDeceased ?? null,
        date_of_death: l.dateOfDeath || null,
        date_of_birth: l.dateOfBirth || null,
        entity_period: l.entityPeriod || null,
        active_evidence: l.activeEvidence || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const persistenceWriter: LeadPersistenceWriter = {
        async upsertLeads() {
          const { error: upsertError } = await client
            .from('leads')
            .upsert(leadRows, {
              onConflict: 'workspace_id,profile_url',
              ignoreDuplicates: true
            });
          if (upsertError) return { data: null, error: upsertError };

          const { data, error } = await client
            .from('leads')
            .select('id, profile_url')
            .eq('workspace_id', workspaceId)
            .in('profile_url', leadRows.map((lead) => lead.profile_url));
          return { data, error };
        },
        async upsertClientLinks(persistedLeads) {
          const clientLeadRows = persistedLeads.map((lead) => ({
            id: generateUuid(),
            workspace_id: workspaceId,
            client_id: clientId,
            lead_id: lead.id,
            search_id: searchId || null,
            status: 'Not Contacted',
            notes: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }));

          const { error } = await client
            .from('client_leads')
            .upsert(clientLeadRows, {
              onConflict: 'client_id,lead_id',
              ignoreDuplicates: true
            });
          if (error) return { confirmedCount: 0, error };

          const { data, error: verificationError } = await client
            .from('client_leads')
            .select('lead_id')
            .eq('workspace_id', workspaceId)
            .eq('client_id', clientId)
            .in('lead_id', persistedLeads.map((lead) => lead.id));
          return {
            confirmedCount: Array.isArray(data) ? data.length : 0,
            error: verificationError
          };
        }
      };
      return persistLeadsAndLinks(localResult, newLeads.length, persistenceWriter);
    }

    return persistLeadsAndLinks(localResult, newLeads.length);
  }

  /**
   * Update individual lead status in Supabase and local cache.
   */
  static async updateLeadStatus(
    workspaceId: string,
    leadId: string,
    status: LeadStatus
  ): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads/${encodeURIComponent(leadId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status })
      }
    );

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success) {
      dbService.updateLeadStatus(workspaceId, leadId, status);
      return;
    }

    if (supabase) {
      try {
        await supabase
          .from('client_leads')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('lead_id', leadId)
          .eq('workspace_id', workspaceId);
      } catch (err) {
        console.warn('Supabase updateLeadStatus error:', err);
      }
    }

    dbService.updateLeadStatus(workspaceId, leadId, status);
  }

  /**
   * Update lead notes in Supabase and local cache.
   */
  static async updateLeadNotes(
    workspaceId: string,
    leadId: string,
    notes: string
  ): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads/${encodeURIComponent(leadId)}/notes`,
      {
        method: 'PATCH',
        body: JSON.stringify({ notes })
      }
    );

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success) {
      dbService.updateLeadNotes(workspaceId, leadId, notes);
      return;
    }

    if (supabase) {
      try {
        await supabase
          .from('client_leads')
          .update({ notes, updated_at: new Date().toISOString() })
          .eq('lead_id', leadId)
          .eq('workspace_id', workspaceId);
      } catch (err) {
        console.warn('Supabase updateLeadNotes error:', err);
      }
    }

    dbService.updateLeadNotes(workspaceId, leadId, notes);
  }

  /**
   * Update lead Instagram information in Supabase and local cache.
   */
  static async updateLeadInstagram(
    workspaceId: string,
    leadId: string,
    instagramData: {
      instagramUsername?: string;
      instagramProfileUrl?: string;
      instagramVerificationStatus?: InstagramVerificationStatus;
      instagramVerificationEvidence?: string;
      instagramDiscoverySource?: string;
      instagramLastCheckedAt?: string;
    }
  ): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads/${encodeURIComponent(leadId)}/instagram`,
      {
        method: 'PATCH',
        body: JSON.stringify({ instagramData })
      }
    );

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success) {
      dbService.updateLeadInstagram(workspaceId, leadId, instagramData);
      return;
    }

    if (supabase) {
      try {
        await supabase
          .from('leads')
          .update({
            instagram_username: instagramData.instagramUsername || null,
            instagram_profile_url: instagramData.instagramProfileUrl || null,
            instagram_verification_status: instagramData.instagramVerificationStatus || null,
            instagram_verification_evidence: instagramData.instagramVerificationEvidence || null,
            instagram_discovery_source: instagramData.instagramDiscoverySource || null,
            instagram_last_checked_at: instagramData.instagramLastCheckedAt || new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', leadId)
          .eq('workspace_id', workspaceId);
      } catch (err) {
        console.warn('Supabase updateLeadInstagram error:', err);
      }
    }

    dbService.updateLeadInstagram(workspaceId, leadId, instagramData);
  }

  /**
   * Delete selected leads from Supabase and local cache.
   */
  static async deleteSelectedLeads(workspaceId: string, leadIds: string[]): Promise<void> {
    const apiRes = await callDataApi(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/leads/delete-selected`,
      {
        method: 'POST',
        body: JSON.stringify({ leadIds })
      }
    );

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success) {
      dbService.deleteSelectedLeads(workspaceId, leadIds);
      return;
    }

    if (supabase && leadIds.length > 0) {
      try {
        await supabase
          .from('client_leads')
          .delete()
          .in('lead_id', leadIds)
          .eq('workspace_id', workspaceId);
      } catch (err) {
        console.warn('Supabase deleteSelectedLeads error:', err);
      }
    }

    dbService.deleteSelectedLeads(workspaceId, leadIds);
  }

  /**
   * Fetch searches history for the workspace.
   */
  static async getSearches(workspaceId: string): Promise<SearchHistoryRecord[]> {
    const apiRes = await callDataApi<{ searches: SearchHistoryRecord[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/searches`
    );

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success && Array.isArray(apiRes.data?.searches)) {
      return apiRes.data.searches;
    }

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('lead_searches')
          .select('*, clients(name)')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map((item: any) => ({
            id: item.id,
            workspaceId: item.workspace_id,
            clientId: item.client_id,
            clientName: item.clients?.name || 'Client',
            searchDate: item.created_at,
            filters: item.filters as LeadFilter,
            candidatesFound: item.candidates_found || 0,
            validLeads: item.valid_leads || 0,
            duplicatesRemoved: item.duplicates_removed || 0,
            finalLeadCount: item.final_lead_count || 0,
            createdBy: item.created_by_user_email || 'Owner'
          }));
        }
      } catch (err) {
        console.warn('Supabase getSearches error:', err);
      }
    }

    return dbService.getSearches(workspaceId);
  }

  /**
   * Save search history record in Supabase and local cache.
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
    createdBy: string
  ): Promise<SearchHistoryRecord> {
    const apiRes = await callDataApi<{ search: SearchHistoryRecord }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/searches`,
      {
        method: 'POST',
        body: JSON.stringify({
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

    if (apiRes.status === 401 || apiRes.status === 403) {
      throw new Error(apiRes.error || 'Access denied.');
    }
    if (apiRes.success && apiRes.data?.search) {
      dbService.saveSearchRecord(
        workspaceId,
        clientId,
        clientName,
        filters,
        candidatesFound,
        validLeads,
        duplicatesRemoved,
        finalLeadCount,
        createdBy,
        apiRes.data.search.id
      );
      return apiRes.data.search;
    }

    const searchId = generateUuid();
    const now = new Date().toISOString();

    const record: SearchHistoryRecord = {
      id: searchId,
      workspaceId,
      clientId,
      clientName,
      searchDate: now,
      filters,
      candidatesFound,
      validLeads,
      duplicatesRemoved,
      finalLeadCount,
      createdBy
    };

    if (supabase) {
      try {
        await supabase.from('lead_searches').insert([
          {
            id: searchId,
            workspace_id: workspaceId,
            client_id: clientId,
            filters,
            candidates_found: candidatesFound,
            valid_leads: validLeads,
            duplicates_removed: duplicatesRemoved,
            final_lead_count: finalLeadCount,
            created_by_user_email: createdBy,
            created_at: now,
            updated_at: now
          }
        ]);
      } catch (err) {
        console.warn('Supabase saveSearchRecord error:', err);
      }
    }

    dbService.saveSearchRecord(
      workspaceId,
      clientId,
      clientName,
      filters,
      candidatesFound,
      validLeads,
      duplicatesRemoved,
      finalLeadCount,
      createdBy,
      searchId
    );

    return record;
  }
}


