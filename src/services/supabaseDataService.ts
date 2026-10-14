import { supabase } from './supabase';
import { dbService } from './storage';
import { Client, LeadRecord, LeadStatus, SearchHistoryRecord, RawLead, LeadFilter } from '../types';

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

export class SupabaseDataService {
  /**
   * Check if Supabase client is configured and operational
   */
  static isAvailable(): boolean {
    return Boolean(supabase);
  }

  /**
   * Fetch all clients for the given workspace.
   * Pulls from Supabase if connected, falls back to local storage cache.
   */
  static async getClients(workspaceId: string): Promise<Client[]> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data) && data.length > 0) {
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

          // Sync into localStorage cache
          return mapped;
        }
      } catch (err) {
        console.warn('Supabase getClients error, falling back to local storage cache:', err);
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
    const id = generateUuid();
    const now = new Date().toISOString();

    const newClient: Client = {
      id,
      workspaceId,
      name,
      niche,
      notes,
      createdAt: now,
      updatedAt: now,
      leadsCount: 0,
      searchesCount: 0
    };

    if (supabase) {
      try {
        const { error } = await supabase.from('clients').insert([
          {
            id,
            workspace_id: workspaceId,
            name,
            niche,
            notes,
            created_at: now,
            updated_at: now
          }
        ]);

        if (error) {
          console.warn('Supabase createClient insert error:', error.message);
        }
      } catch (err) {
        console.warn('Supabase createClient exception:', err);
      }
    }

    // Always update local cache for responsiveness
    dbService.createClientWithId(id, workspaceId, name, niche, notes, now);
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
    const now = new Date().toISOString();

    if (supabase) {
      try {
        const dbUpdates: any = { updated_at: now };
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.niche !== undefined) dbUpdates.niche = updates.niche;
        if (updates.notes !== undefined) dbUpdates.notes = updates.notes;

        const { error } = await supabase
          .from('clients')
          .update(dbUpdates)
          .eq('id', clientId)
          .eq('workspace_id', workspaceId);

        if (error) {
          console.warn('Supabase updateClient error:', error.message);
        }
      } catch (err) {
        console.warn('Supabase updateClient exception:', err);
      }
    }

    return dbService.updateClient(workspaceId, clientId, updates);
  }

  /**
   * Delete client and associated records.
   */
  static async deleteClient(workspaceId: string, clientId: string): Promise<void> {
    if (supabase) {
      try {
        await supabase
          .from('clients')
          .delete()
          .eq('id', clientId)
          .eq('workspace_id', workspaceId);
      } catch (err) {
        console.warn('Supabase deleteClient exception:', err);
      }
    }

    dbService.deleteClient(workspaceId, clientId);
  }

  /**
   * Retrieve all leads for a workspace or filtered by client.
   */
  static async getAllLeads(workspaceId: string, clientId?: string): Promise<LeadRecord[]> {
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
              connectionsOrFollowers: item.connections_or_followers || '500+ connections',
              lastActivityDate: item.last_activity_date || 'N/A',
              dateAdded: (item.created_at || new Date().toISOString()).split('T')[0],
              status: (junction.status as LeadStatus) || 'Not Contacted',
              notes: junction.notes || '',
              source: item.source || 'LeadOcean B2B People Search API'
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
  ): Promise<{ added: number; duplicatesSkipped: number }> {
    // First deduplicate and save in local storage service for synchronous UI update
    const localResult = dbService.saveLeadsForClient(workspaceId, clientId, newLeads);

    if (supabase && newLeads.length > 0) {
      try {
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
          source: l.source || 'LeadOcean B2B People Search API',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));

        // Upsert into leads table with conflict resolution on (workspace_id, profile_url)
        const { data: insertedLeads, error: leadsError } = await supabase
          .from('leads')
          .upsert(leadRows, { onConflict: 'workspace_id,profile_url' })
          .select('id, profile_url');

        if (!leadsError && Array.isArray(insertedLeads)) {
          // Link with client_leads
          const clientLeadRows = insertedLeads.map((il: any) => ({
            id: generateUuid(),
            workspace_id: workspaceId,
            client_id: clientId,
            lead_id: il.id,
            search_id: searchId || null,
            status: 'Not Contacted',
            notes: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }));

          await supabase
            .from('client_leads')
            .upsert(clientLeadRows, { onConflict: 'client_id,lead_id' });
        }
      } catch (err) {
        console.warn('Supabase saveLeadsForClient error:', err);
      }
    }

    return localResult;
  }

  /**
   * Update individual lead status in Supabase and local cache.
   */
  static async updateLeadStatus(
    workspaceId: string,
    leadId: string,
    status: LeadStatus
  ): Promise<void> {
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
   * Delete selected leads from Supabase and local cache.
   */
  static async deleteSelectedLeads(workspaceId: string, leadIds: string[]): Promise<void> {
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
      createdBy
    );

    return record;
  }
}
