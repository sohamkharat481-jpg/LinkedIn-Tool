import {
  Client,
  LeadRecord,
  LeadStatus,
  SearchHistoryRecord,
  Workspace,
  GoogleIntegration,
  ExportHistoryRecord,
  LeadFilter
} from '../types';

const STORAGE_KEYS = {
  WORKSPACES: 'llf_workspaces_v1',
  ACTIVE_WORKSPACE_ID: 'llf_active_workspace_id_v1',
  CLIENTS: 'llf_clients_v1',
  SEARCHES: 'llf_searches_v1',
  LEADS: 'llf_leads_v1',
  GOOGLE_INTEGRATIONS: 'llf_google_integrations_v1',
  EXPORT_HISTORY: 'llf_export_history_v1',
  SUPABASE_CONFIG: 'llf_supabase_config_v1'
};

const DEFAULT_WORKSPACE_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const DEFAULT_WORKSPACE: Workspace = {
  id: DEFAULT_WORKSPACE_UUID,
  name: 'Acme Growth Agency',
  description: 'Primary agency workspace'
};

const SEED_CLIENTS: Client[] = [];

const SEED_LEADS: LeadRecord[] = [];

const SEED_SEARCHES: SearchHistoryRecord[] = [];

// In-Memory Storage & LocalStorage Synchronization
class StorageService {
  constructor() {
    this.migrateLocalStorageIfNeeded();
  }

  private migrateLocalStorageIfNeeded(): void {
    try {
      if (typeof window === 'undefined') return;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const workspacesRaw = localStorage.getItem(STORAGE_KEYS.WORKSPACES);
      if (!workspacesRaw) return;
      const workspaces: Workspace[] = JSON.parse(workspacesRaw);
      let needsMigration = false;
      const idMapping = new Map<string, string>();

      const migratedWorkspaces = workspaces.map(ws => {
        if (!uuidRegex.test(ws.id)) {
          needsMigration = true;
          const newId = ws.id === 'ws-default-01' 
            ? DEFAULT_WORKSPACE_UUID
            : (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12');
          idMapping.set(ws.id, newId);
          return { ...ws, id: newId };
        }
        return ws;
      });

      if (needsMigration) {
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(migratedWorkspaces));

        const activeId = localStorage.getItem(STORAGE_KEYS.ACTIVE_WORKSPACE_ID);
        if (activeId && idMapping.has(activeId)) {
          localStorage.setItem(STORAGE_KEYS.ACTIVE_WORKSPACE_ID, idMapping.get(activeId)!);
        }

        const clientsRaw = localStorage.getItem(STORAGE_KEYS.CLIENTS);
        if (clientsRaw) {
          const clients: Client[] = JSON.parse(clientsRaw);
          const migratedClients = clients.map(c => {
            if (idMapping.has(c.workspaceId)) {
              return { ...c, workspaceId: idMapping.get(c.workspaceId)! };
            }
            return c;
          });
          localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(migratedClients));
        }

        const leadsRaw = localStorage.getItem(STORAGE_KEYS.LEADS);
        if (leadsRaw) {
          const leads: LeadRecord[] = JSON.parse(leadsRaw);
          const migratedLeads = leads.map(l => {
            if (idMapping.has(l.workspaceId)) {
              return { ...l, workspaceId: idMapping.get(l.workspaceId)! };
            }
            return l;
          });
          localStorage.setItem(STORAGE_KEYS.LEADS, JSON.stringify(migratedLeads));
        }

        const searchesRaw = localStorage.getItem(STORAGE_KEYS.SEARCHES);
        if (searchesRaw) {
          const searches: SearchHistoryRecord[] = JSON.parse(searchesRaw);
          const migratedSearches = searches.map(s => {
            if (idMapping.has(s.workspaceId)) {
              return { ...s, workspaceId: idMapping.get(s.workspaceId)! };
            }
            return s;
          });
          localStorage.setItem(STORAGE_KEYS.SEARCHES, JSON.stringify(migratedSearches));
        }

        const giRaw = localStorage.getItem(STORAGE_KEYS.GOOGLE_INTEGRATIONS);
        if (giRaw) {
          const gi: GoogleIntegration[] = JSON.parse(giRaw);
          const migratedGi = gi.map(g => {
            if (idMapping.has(g.workspaceId)) {
              return { ...g, workspaceId: idMapping.get(g.workspaceId)! };
            }
            return g;
          });
          localStorage.setItem(STORAGE_KEYS.GOOGLE_INTEGRATIONS, JSON.stringify(migratedGi));
        }
      }
    } catch (e) {
      console.warn('LocalStorage migration error:', e);
    }
  }

  private getItem<T>(key: string, defaultValue: T): T {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private setItem<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('LocalStorage write error:', e);
    }
  }

  // Workspaces
  getWorkspaces(): Workspace[] {
    const list = this.getItem<Workspace[]>(STORAGE_KEYS.WORKSPACES, [DEFAULT_WORKSPACE]);
    if (!list.length) {
      this.setItem(STORAGE_KEYS.WORKSPACES, [DEFAULT_WORKSPACE]);
      return [DEFAULT_WORKSPACE];
    }
    return list;
  }

  getActiveWorkspaceId(): string {
    const activeId = this.getItem<string>(STORAGE_KEYS.ACTIVE_WORKSPACE_ID, DEFAULT_WORKSPACE.id);
    const exists = this.getWorkspaces().some((w) => w.id === activeId);
    if (!exists) {
      this.setItem(STORAGE_KEYS.ACTIVE_WORKSPACE_ID, DEFAULT_WORKSPACE.id);
      return DEFAULT_WORKSPACE.id;
    }
    return activeId;
  }

  setActiveWorkspaceId(id: string): void {
    this.setItem(STORAGE_KEYS.ACTIVE_WORKSPACE_ID, id);
  }

  createWorkspace(name: string, description: string): Workspace {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' 
      ? crypto.randomUUID() 
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
    const newWs: Workspace = {
      id,
      name,
      description
    };
    const list = this.getWorkspaces();
    list.push(newWs);
    this.setItem(STORAGE_KEYS.WORKSPACES, list);
    this.setActiveWorkspaceId(newWs.id);
    return newWs;
  }

  // Clients (Isolated per Workspace)
  getClients(workspaceId: string): Client[] {
    const clients = this.getItem<Client[]>(STORAGE_KEYS.CLIENTS, SEED_CLIENTS);
    if (!clients || clients.length === 0) {
      this.setItem(STORAGE_KEYS.CLIENTS, SEED_CLIENTS);
      return SEED_CLIENTS.filter((c) => c.workspaceId === workspaceId);
    }

    const wsClients = clients.filter((c) => c.workspaceId === workspaceId);
    const leads = this.getAllLeads(workspaceId);
    const searches = this.getSearches(workspaceId);

    return wsClients.map((c) => {
      const clientLeads = leads.filter((l) => l.clientId === c.id);
      const clientSearches = searches.filter((s) => s.clientId === c.id);
      return {
        ...c,
        leadsCount: clientLeads.length,
        searchesCount: clientSearches.length
      };
    });
  }

  getClientById(workspaceId: string, clientId: string): Client | undefined {
    return this.getClients(workspaceId).find((c) => c.id === clientId);
  }

  createClient(workspaceId: string, name: string, niche: string, notes: string): Client {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `client-${Date.now()}`;
    return this.createClientWithId(id, workspaceId, name, niche, notes);
  }

  createClientWithId(id: string, workspaceId: string, name: string, niche: string, notes: string, createdAt?: string): Client {
    const newClient: Client = {
      id,
      workspaceId,
      name,
      niche,
      notes,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: createdAt || new Date().toISOString(),
      leadsCount: 0,
      searchesCount: 0
    };

    const clients = this.getItem<Client[]>(STORAGE_KEYS.CLIENTS, SEED_CLIENTS);
    clients.unshift(newClient);
    this.setItem(STORAGE_KEYS.CLIENTS, clients);
    return newClient;
  }

  updateClient(workspaceId: string, clientId: string, updates: { name?: string; niche?: string; notes?: string }): Client {
    const clients = this.getItem<Client[]>(STORAGE_KEYS.CLIENTS, SEED_CLIENTS);
    const index = clients.findIndex((c) => c.id === clientId && c.workspaceId === workspaceId);
    if (index === -1) throw new Error('Client not found or access denied.');

    const updated = {
      ...clients[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    clients[index] = updated;
    this.setItem(STORAGE_KEYS.CLIENTS, clients);
    return updated;
  }

  deleteClient(workspaceId: string, clientId: string): void {
    const clients = this.getItem<Client[]>(STORAGE_KEYS.CLIENTS, SEED_CLIENTS);
    const filtered = clients.filter((c) => !(c.id === clientId && c.workspaceId === workspaceId));
    this.setItem(STORAGE_KEYS.CLIENTS, filtered);

    // Also remove associated client leads and searches
    this.deleteLeadsForClient(workspaceId, clientId);
    this.deleteSearchesForClient(workspaceId, clientId);
  }

  // Searches
  getSearches(workspaceId: string): SearchHistoryRecord[] {
    const searches = this.getItem<SearchHistoryRecord[]>(STORAGE_KEYS.SEARCHES, SEED_SEARCHES);
    return searches.filter((s) => s.workspaceId === workspaceId);
  }

  getSearchById(workspaceId: string, searchId: string): SearchHistoryRecord | undefined {
    return this.getSearches(workspaceId).find((s) => s.id === searchId);
  }

  saveSearchRecord(
    workspaceId: string,
    clientId: string,
    clientName: string,
    filters: LeadFilter,
    candidatesFound: number,
    validLeads: number,
    duplicatesRemoved: number,
    finalLeadCount: number,
    createdBy: string
  ): SearchHistoryRecord {
    const newSearch: SearchHistoryRecord = {
      id: `search-${Date.now()}`,
      workspaceId,
      clientId,
      clientName,
      searchDate: new Date().toISOString(),
      filters,
      candidatesFound,
      validLeads,
      duplicatesRemoved,
      finalLeadCount,
      createdBy
    };

    const searches = this.getItem<SearchHistoryRecord[]>(STORAGE_KEYS.SEARCHES, SEED_SEARCHES);
    searches.unshift(newSearch);
    this.setItem(STORAGE_KEYS.SEARCHES, searches);
    return newSearch;
  }

  deleteSearchesForClient(workspaceId: string, clientId: string): void {
    const searches = this.getItem<SearchHistoryRecord[]>(STORAGE_KEYS.SEARCHES, SEED_SEARCHES);
    const filtered = searches.filter((s) => !(s.clientId === clientId && s.workspaceId === workspaceId));
    this.setItem(STORAGE_KEYS.SEARCHES, filtered);
  }

  // Leads & Client Leads (ISOLATED BY CLIENT & WORKSPACE)
  getAllLeads(workspaceId: string): LeadRecord[] {
    const leads = this.getItem<LeadRecord[]>(STORAGE_KEYS.LEADS, SEED_LEADS);
    return leads.filter((l) => l.workspaceId === workspaceId);
  }

  getLeadsForClient(workspaceId: string, clientId: string): LeadRecord[] {
    return this.getAllLeads(workspaceId).filter((l) => l.clientId === clientId);
  }

  saveLeadsForClient(workspaceId: string, clientId: string, newLeads: LeadRecord[]): { added: number; duplicatesSkipped: number } {
    const allLeads = this.getItem<LeadRecord[]>(STORAGE_KEYS.LEADS, SEED_LEADS);
    const existingClientLeads = allLeads.filter((l) => l.workspaceId === workspaceId && l.clientId === clientId);
    
    const existingUrls = new Set(existingClientLeads.map((l) => l.profileUrl.toLowerCase()));

    let added = 0;
    let duplicatesSkipped = 0;

    for (const lead of newLeads) {
      if (existingUrls.has(lead.profileUrl.toLowerCase())) {
        duplicatesSkipped++;
      } else {
        allLeads.unshift({
          ...lead,
          id: `lead-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          workspaceId,
          clientId
        });
        existingUrls.add(lead.profileUrl.toLowerCase());
        added++;
      }
    }

    this.setItem(STORAGE_KEYS.LEADS, allLeads);
    return { added, duplicatesSkipped };
  }

  updateLeadStatus(workspaceId: string, leadId: string, newStatus: LeadStatus): void {
    const allLeads = this.getItem<LeadRecord[]>(STORAGE_KEYS.LEADS, SEED_LEADS);
    const index = allLeads.findIndex((l) => l.id === leadId && l.workspaceId === workspaceId);
    if (index !== -1) {
      allLeads[index].status = newStatus;
      this.setItem(STORAGE_KEYS.LEADS, allLeads);
    }
  }

  updateLeadNotes(workspaceId: string, leadId: string, notes: string): void {
    const allLeads = this.getItem<LeadRecord[]>(STORAGE_KEYS.LEADS, SEED_LEADS);
    const index = allLeads.findIndex((l) => l.id === leadId && l.workspaceId === workspaceId);
    if (index !== -1) {
      allLeads[index].notes = notes;
      this.setItem(STORAGE_KEYS.LEADS, allLeads);
    }
  }

  deleteLeadsForClient(workspaceId: string, clientId: string): void {
    const allLeads = this.getItem<LeadRecord[]>(STORAGE_KEYS.LEADS, SEED_LEADS);
    const filtered = allLeads.filter((l) => !(l.clientId === clientId && l.workspaceId === workspaceId));
    this.setItem(STORAGE_KEYS.LEADS, filtered);
  }

  deleteSelectedLeads(workspaceId: string, leadIds: string[]): void {
    const idSet = new Set(leadIds);
    const allLeads = this.getItem<LeadRecord[]>(STORAGE_KEYS.LEADS, SEED_LEADS);
    const filtered = allLeads.filter((l) => !(l.workspaceId === workspaceId && idSet.has(l.id)));
    this.setItem(STORAGE_KEYS.LEADS, filtered);
  }

  // Google Integration & Export History
  getGoogleIntegration(workspaceId: string, clientId: string): GoogleIntegration | undefined {
    const list = this.getItem<GoogleIntegration[]>(STORAGE_KEYS.GOOGLE_INTEGRATIONS, []);
    return list.find((g) => g.workspaceId === workspaceId && g.clientId === clientId);
  }

  saveGoogleIntegration(integration: GoogleIntegration): void {
    const list = this.getItem<GoogleIntegration[]>(STORAGE_KEYS.GOOGLE_INTEGRATIONS, []);
    const index = list.findIndex(
      (g) => g.workspaceId === integration.workspaceId && g.clientId === integration.clientId
    );
    if (index !== -1) {
      list[index] = integration;
    } else {
      list.push(integration);
    }
    this.setItem(STORAGE_KEYS.GOOGLE_INTEGRATIONS, list);
  }

  getExportHistory(workspaceId: string, clientId?: string): ExportHistoryRecord[] {
    const list = this.getItem<ExportHistoryRecord[]>(STORAGE_KEYS.EXPORT_HISTORY, []);
    return list.filter((e) => e.workspaceId === workspaceId && (!clientId || e.clientId === clientId));
  }

  saveExportHistory(record: ExportHistoryRecord): void {
    const list = this.getItem<ExportHistoryRecord[]>(STORAGE_KEYS.EXPORT_HISTORY, []);
    list.unshift(record);
    this.setItem(STORAGE_KEYS.EXPORT_HISTORY, list);
  }
}

export const dbService = new StorageService();
